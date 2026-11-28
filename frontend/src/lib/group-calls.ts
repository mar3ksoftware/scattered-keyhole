// ── Group call controller ───────────────────────────────────────────────
// The mesh signaling rules live here so they stay testable without a React
// tree or a live socket. The 1:1 call path in ChatContext is untouched.
//
// Glare rule (frozen contract): existing participants ALWAYS offer to a
// joiner; the joiner ALWAYS answers. A joiner learns the existing peers from
// `group_call:roster`, while existing participants learn about joiners from
// `group_call:joined`.

import type {
  CallTopology,
  GroupCallAnswerRelay,
  GroupCallIceRelay,
  GroupCallJoinedPayload,
  GroupCallLeftPayload,
  GroupCallOfferRelay,
  GroupCallRosterPayload,
  SfuCredentialsPayload,
} from '../types';
import { EVENTS } from '../types';
import type { CallHandlers } from './calls';
import type { SfuHandle, SfuPeer } from './sfu-call';

export type GroupCallPhase = 'idle' | 'joining' | 'active';

export type GroupCallPeer = {
  readonly userId: string;
  readonly username: string;
  readonly pc?: RTCPeerConnection;
  readonly stream?: MediaStream;
};

export type GroupCallSnapshot = {
  readonly state: GroupCallPhase;
  readonly groupId: string | null;
  readonly topology: CallTopology;
  readonly peers: readonly GroupCallPeer[];
  readonly localStream: MediaStream | null;
};

export type GroupCallControllerDeps = {
  readonly selfUserId: string;
  readonly emit: (event: string, payload: unknown) => void;
  readonly createPeerConnection: (handlers: CallHandlers) => RTCPeerConnection;
  readonly getUserMedia: () => Promise<MediaStream>;
  readonly addTracks: (pc: RTCPeerConnection, stream: MediaStream) => void;
  readonly onChange: (snapshot: GroupCallSnapshot) => void;
  readonly onError: (message: string) => void;
};

export type GroupCallController = {
  readonly join: (groupId: string, topology: CallTopology) => void;
  readonly roster: (payload: GroupCallRosterPayload) => void;
  readonly joined: (payload: GroupCallJoinedPayload) => Promise<void>;
  readonly offer: (payload: GroupCallOfferRelay) => Promise<void>;
  readonly answer: (payload: GroupCallAnswerRelay) => Promise<void>;
  readonly ice: (payload: GroupCallIceRelay) => Promise<void>;
  readonly left: (payload: GroupCallLeftPayload) => void;
  readonly sfuCredentials: (payload: SfuCredentialsPayload) => Promise<void>;
  readonly leave: () => void;
  readonly dispose: () => void;
};

type PeerEntry = {
  userId: string;
  username: string;
  pc: RTCPeerConnection | null;
  stream: MediaStream | null;
};

const EMPTY: GroupCallSnapshot = {
  state: 'idle',
  groupId: null,
  topology: 'mesh',
  peers: [],
  localStream: null,
};

function stopTracks(stream: MediaStream | null): void {
  if (stream === null) return;
  for (const track of stream.getTracks()) track.stop();
}

export function createGroupCallController(deps: GroupCallControllerDeps): GroupCallController {
  const peers = new Map<string, PeerEntry>();
  const pendingIce = new Map<string, RTCIceCandidateInit[]>();
  // Peers that announced themselves while our roster was still in flight.
  // They are absent from that snapshot, so we offer to them on activation.
  const lateJoiners = new Set<string>();
  let phase: GroupCallPhase = 'idle';
  let groupId: string | null = null;
  let topology: CallTopology = 'mesh';
  let localStream: MediaStream | null = null;
  let mediaPromise: Promise<MediaStream | null> | null = null;
  let sfuHandle: SfuHandle | null = null;
  let disposed = false;

  const snapshot = (): GroupCallSnapshot => ({
    state: phase,
    groupId,
    topology,
    peers: Array.from(peers.values()).map((entry) => ({
      userId: entry.userId,
      username: entry.username,
      ...(entry.pc !== null ? { pc: entry.pc } : {}),
      ...(entry.stream !== null ? { stream: entry.stream } : {}),
    })),
    localStream,
  });

  const notify = (): void => {
    if (!disposed) deps.onChange(snapshot());
  };

  const closePeer = (userId: string): void => {
    const entry = peers.get(userId);
    if (entry === undefined) return;
    entry.pc?.close();
    peers.delete(userId);
    pendingIce.delete(userId);
    lateJoiners.delete(userId);
  };

  const clearResources = (): void => {
    for (const entry of peers.values()) entry.pc?.close();
    peers.clear();
    pendingIce.clear();
    lateJoiners.clear();
    stopTracks(localStream);
    localStream = null;
    mediaPromise = null;
    if (sfuHandle !== null) {
      const handle = sfuHandle;
      sfuHandle = null;
      void handle.disconnect();
    }
  };

  const reset = (): void => {
    clearResources();
    phase = 'idle';
    groupId = null;
    topology = 'mesh';
    notify();
  };

  const ensureLocalStream = (): Promise<MediaStream | null> => {
    if (localStream !== null) return Promise.resolve(localStream);
    if (mediaPromise !== null) return mediaPromise;
    mediaPromise = deps.getUserMedia().then(
      (stream) => {
        if (phase === 'idle' || disposed) {
          stopTracks(stream);
          return null;
        }
        localStream = stream;
        notify();
        return stream;
      },
      () => {
        mediaPromise = null;
        deps.onError('Could not access camera or microphone.');
        return null;
      },
    );
    return mediaPromise;
  };

  const flushIce = async (userId: string, pc: RTCPeerConnection): Promise<void> => {
    const queued = pendingIce.get(userId);
    if (queued === undefined) return;
    pendingIce.delete(userId);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {}
    }
  };

  const createPc = (entry: PeerEntry): RTCPeerConnection => {
    const pc = deps.createPeerConnection({
      onIceCandidate: (candidate) => {
        if (groupId === null) return;
        deps.emit(EVENTS.CLIENT.GROUP_CALL_ICE, {
          groupId,
          // The server resolves `to` with getUserByUsername, so the wire value
          // must be the username rather than the opaque userId.
          to: entry.username,
          candidate: JSON.stringify(candidate),
        });
      },
      onTrack: (stream) => {
        const current = peers.get(entry.userId);
        if (current === undefined || current.pc !== pc) return;
        current.stream = stream;
        notify();
      },
      onConnectionStateChange: (state) => {
        if (state !== 'failed' && state !== 'closed') return;
        const current = peers.get(entry.userId);
        if (current === undefined || current.pc !== pc) return;
        current.pc = null;
        current.stream = null;
        try {
          pc.close();
        } catch {}
        notify();
      },
    });
    return pc;
  };

  const offerTo = async (entry: PeerEntry): Promise<void> => {
    const stream = await ensureLocalStream();
    if (stream === null || phase !== 'active' || groupId === null) return;
    if (entry.pc !== null || !peers.has(entry.userId)) return;

    const pc = createPc(entry);
    entry.pc = pc;
    deps.addTracks(pc, stream);
    notify();
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      deps.emit(EVENTS.CLIENT.GROUP_CALL_OFFER, {
        groupId,
        to: entry.username,
        sdp: offer.sdp ?? '',
      });
    } catch {
      closePeer(entry.userId);
      notify();
    }
  };

  const join = (nextGroupId: string, nextTopology: CallTopology): void => {
    if (phase !== 'idle') return;
    clearResources();
    groupId = nextGroupId;
    topology = nextTopology;
    phase = 'joining';
    notify();
    if (topology === 'sfu') {
      deps.emit(EVENTS.CLIENT.GROUP_CALL_SFU_TOKEN, { groupId });
    } else {
      deps.emit(EVENTS.CLIENT.GROUP_CALL_JOIN, { groupId });
    }
  };

  const roster = (payload: GroupCallRosterPayload): void => {
    if (groupId === null || payload.groupId !== groupId) return;

    const next = new Map<string, PeerEntry>();
    for (const peer of payload.peers) {
      if (peer.userId === deps.selfUserId) continue;
      const existing = peers.get(peer.userId);
      next.set(
        peer.userId,
        existing ?? { userId: peer.userId, username: peer.username, pc: null, stream: null },
      );
    }
    // Peers that joined while this roster was in flight are not part of the
    // snapshot; keep them so the offer pass below reaches them.
    const pendingOffers = Array.from(lateJoiners);
    lateJoiners.clear();
    for (const userId of pendingOffers) {
      const existing = peers.get(userId);
      if (existing !== undefined) next.set(userId, existing);
    }
    for (const [userId, entry] of peers) {
      if (!next.has(userId)) entry.pc?.close();
    }
    peers.clear();
    for (const [userId, entry] of next) peers.set(userId, entry);

    phase = 'active';
    notify();
    // The roster means the server accepted the join. Existing participants
    // need a local stream before they can offer to anyone.
    if (topology === 'mesh') {
      void ensureLocalStream();
      // Two clients can join inside one round trip: the later joiner is absent
      // from this snapshot, so offer to them now that we are active.
      for (const userId of pendingOffers) {
        const entry = peers.get(userId);
        if (entry !== undefined) void offerTo(entry);
      }
    }
  };

  const joined = async (payload: GroupCallJoinedPayload): Promise<void> => {
    if (payload.from === deps.selfUserId) return;
    if (groupId === null) {
      // Not in a call yet: keep a lightweight indicator only.
      groupId = payload.groupId;
      topology = 'mesh';
    }
    if (payload.groupId !== groupId) return;

    let entry = peers.get(payload.from);
    if (entry === undefined) {
      entry = { userId: payload.from, username: payload.fromUsername, pc: null, stream: null };
      peers.set(payload.from, entry);
      notify();
    }

    // Only an existing participant in an active mesh call offers. Joiners
    // stay passive and answer the offers they receive.
    if (topology !== 'mesh') return;
    if (phase !== 'active') {
      // Our roster has not landed yet, so it cannot list this peer. Remember
      // them and offer as soon as the server activates the call.
      if (phase === 'joining') lateJoiners.add(payload.from);
      return;
    }
    await offerTo(entry);
  };

  const offer = async (payload: GroupCallOfferRelay): Promise<void> => {
    if (groupId === null || payload.groupId !== groupId || phase !== 'active') return;
    if (payload.from === deps.selfUserId) return;

    const stream = await ensureLocalStream();
    if (stream === null || phase !== 'active') return;

    let entry = peers.get(payload.from);
    if (entry === undefined) {
      entry = {
        userId: payload.from,
        username: payload.fromUsername,
        pc: null,
        stream: null,
      };
      peers.set(payload.from, entry);
    }
    if (entry.pc !== null) return;

    const pc = createPc(entry);
    entry.pc = pc;
    deps.addTracks(pc, stream);
    notify();
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
      await flushIce(entry.userId, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      deps.emit(EVENTS.CLIENT.GROUP_CALL_ANSWER, {
        groupId,
        to: entry.username,
        sdp: answer.sdp ?? '',
      });
    } catch {
      closePeer(entry.userId);
      notify();
    }
  };

  const answer = async (payload: GroupCallAnswerRelay): Promise<void> => {
    if (groupId === null || payload.groupId !== groupId) return;
    const entry = peers.get(payload.from);
    if (entry === undefined || entry.pc === null) return;
    try {
      await entry.pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
      await flushIce(payload.from, entry.pc);
    } catch {}
  };

  const ice = async (payload: GroupCallIceRelay): Promise<void> => {
    if (groupId === null || payload.groupId !== groupId) return;
    let candidate: RTCIceCandidateInit;
    try {
      candidate = JSON.parse(payload.candidate) as RTCIceCandidateInit;
    } catch {
      return;
    }

    const entry = peers.get(payload.from);
    if (entry !== undefined && entry.pc !== null && entry.pc.remoteDescription !== null) {
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch {}
      return;
    }
    const queued = pendingIce.get(payload.from) ?? [];
    queued.push(candidate);
    pendingIce.set(payload.from, queued);
  };

  const left = (payload: GroupCallLeftPayload): void => {
    if (groupId === null || payload.groupId !== groupId) return;
    if (payload.from === deps.selfUserId) {
      reset();
      return;
    }
    closePeer(payload.from);
    if (phase === 'idle' && peers.size === 0) groupId = null;
    notify();
  };

  const sfuCredentials = async (payload: SfuCredentialsPayload): Promise<void> => {
    if (groupId === null || payload.groupId !== groupId) return;
    if (topology !== 'sfu' || phase === 'idle' || sfuHandle !== null) return;

    let connected: SfuHandle | null = null;
    try {
      const { connectSfuRoom } = await import('./sfu-call');
      const handle = await connectSfuRoom({
        groupId: payload.groupId,
        url: payload.url,
        token: payload.token,
        onPeers: (sfuPeers: readonly SfuPeer[]) => {
          if (groupId === null) return;
          peers.clear();
          for (const peer of sfuPeers) {
            if (peer.userId === deps.selfUserId) continue;
            peers.set(peer.userId, {
              userId: peer.userId,
              username: peer.username,
              pc: null,
              stream: peer.stream,
            });
          }
          localStream = connected?.localStream() ?? null;
          phase = 'active';
          notify();
        },
        onDisconnected: () => {
          sfuHandle = null;
          if (phase !== 'idle') reset();
        },
      });
      connected = handle;
      sfuHandle = handle;
      localStream = handle.localStream();
      phase = 'active';
      notify();
    } catch {
      deps.onError('SFU calls are not configured on this server.');
      reset();
    }
  };

  const leave = (): void => {
    if (phase === 'idle') return;
    if (topology === 'mesh' && groupId !== null) {
      deps.emit(EVENTS.CLIENT.GROUP_CALL_LEAVE, { groupId });
    }
    reset();
  };

  const dispose = (): void => {
    disposed = true;
    clearResources();
    phase = 'idle';
    groupId = null;
    topology = 'mesh';
  };

  return {
    join,
    roster,
    joined,
    offer,
    answer,
    ice,
    left,
    sfuCredentials,
    leave,
    dispose,
  };
}

export const EMPTY_GROUP_CALL = EMPTY;
