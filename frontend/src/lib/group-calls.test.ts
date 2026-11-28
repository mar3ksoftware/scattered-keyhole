import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CallHandlers } from './calls';
import {
  createGroupCallController,
  type GroupCallController,
  type GroupCallSnapshot,
} from './group-calls';

type Emitted = { readonly event: string; readonly payload: unknown };

type FakeTrack = { stopped: boolean; stop: () => void };

class FakePc {
  remoteDescription: RTCSessionDescription | null = null;
  localDescription: RTCSessionDescription | null = null;
  closed = false;
  tracks: MediaStreamTrack[] = [];
  candidates: RTCIceCandidateInit[] = [];
  readonly handlers: CallHandlers;

  constructor(handlers: CallHandlers) {
    this.handlers = handlers;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'offer-sdp' };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'answer-sdp' };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description as RTCSessionDescription;
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description as RTCSessionDescription;
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.candidates.push(candidate);
  }

  close(): void {
    this.closed = true;
  }
}

function fakeStream(): { stream: MediaStream; allStopped: () => boolean } {
  const tracks: FakeTrack[] = [
    {
      stopped: false,
      stop() {
        this.stopped = true;
      },
    },
    {
      stopped: false,
      stop() {
        this.stopped = true;
      },
    },
  ];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  return { stream, allStopped: () => tracks.every((track) => track.stopped) };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

type Harness = {
  readonly controller: GroupCallController;
  readonly emitted: Emitted[];
  readonly snapshots: GroupCallSnapshot[];
  readonly pcs: FakePc[];
  readonly allStopped: () => boolean;
  readonly errors: string[];
};

function harness(): Harness {
  const emitted: Emitted[] = [];
  const snapshots: GroupCallSnapshot[] = [];
  const pcs: FakePc[] = [];
  const errors: string[] = [];
  const { stream, allStopped } = fakeStream();

  const controller = createGroupCallController({
    selfUserId: 'me',
    emit: (event, payload) => emitted.push({ event, payload }),
    createPeerConnection: (handlers) => {
      const pc = new FakePc(handlers);
      pcs.push(pc);
      return pc as unknown as RTCPeerConnection;
    },
    getUserMedia: async () => stream,
    addTracks: (pc, media) => {
      (pc as unknown as FakePc).tracks.push(...media.getTracks());
    },
    onChange: (snapshot) => snapshots.push(snapshot),
    onError: (message) => errors.push(message),
  });

  return { controller, emitted, snapshots, pcs, allStopped, errors };
}

function lastSnapshot(harness: Harness): GroupCallSnapshot {
  const snapshot = harness.snapshots[harness.snapshots.length - 1];
  assert.ok(snapshot !== undefined, 'controller must publish a snapshot');
  return snapshot;
}

function eventPayload(harness: Harness, event: string): Record<string, unknown> {
  const found = [...harness.emitted].reverse().find((entry) => entry.event === event);
  assert.ok(found !== undefined, `expected a ${event} emit`);
  return found.payload as Record<string, unknown>;
}

test('mesh join emits group_call:join and the roster activates the call', () => {
  const h = harness();
  h.controller.join('g1', 'mesh');

  assert.deepEqual(
    h.emitted.map((entry) => entry.event),
    ['group_call:join'],
  );
  assert.equal(eventPayload(h, 'group_call:join').groupId, 'g1');
  assert.equal(lastSnapshot(h).state, 'joining');

  h.controller.roster({ groupId: 'g1', peers: [{ userId: 'u2', username: 'bob' }] });
  const snapshot = lastSnapshot(h);
  assert.equal(snapshot.state, 'active');
  assert.equal(snapshot.peers.length, 1);
  assert.equal(snapshot.peers[0]?.username, 'bob');
  assert.equal(snapshot.peers[0]?.pc, undefined, 'the joiner waits for offers');
});

test('an existing participant offers to a joiner on group_call:joined', async () => {
  const h = harness();
  h.controller.join('g1', 'mesh');
  h.controller.roster({ groupId: 'g1', peers: [] });
  await tick();

  await h.controller.joined({ groupId: 'g1', from: 'u2', fromUsername: 'bob' });

  assert.equal(h.pcs.length, 1);
  assert.ok(h.pcs[0]?.tracks.length === 2, 'local tracks are added before the offer');
  assert.equal(eventPayload(h, 'group_call:offer').to, 'bob');
  assert.equal(eventPayload(h, 'group_call:offer').sdp, 'offer-sdp');
});

test('a peer that joins while our roster is in flight still gets an offer', async () => {
  const h = harness();
  h.controller.join('g1', 'mesh');
  assert.equal(lastSnapshot(h).state, 'joining');

  // Simultaneous join: this peer is not in the roster the server is about to
  // send us, so it must be remembered and offered to on activation.
  await h.controller.joined({ groupId: 'g1', from: 'u2', fromUsername: 'bob' });
  assert.equal(h.pcs.length, 0, 'joiners stay passive until activated');

  h.controller.roster({ groupId: 'g1', peers: [] });
  await tick();

  assert.equal(h.pcs.length, 1);
  assert.equal(eventPayload(h, 'group_call:offer').to, 'bob');
  assert.equal(lastSnapshot(h).peers.length, 1);
});

test('a joiner answers an offer instead of offering back', async () => {
  const h = harness();
  h.controller.join('g1', 'mesh');
  h.controller.roster({ groupId: 'g1', peers: [{ userId: 'u2', username: 'bob' }] });

  await h.controller.offer({
    groupId: 'g1',
    from: 'u2',
    fromUsername: 'bob',
    sdp: 'remote-offer',
  });

  assert.equal(h.pcs.length, 1);
  assert.equal(h.pcs[0]?.remoteDescription?.type, 'offer');
  assert.equal(eventPayload(h, 'group_call:answer').to, 'bob');
  assert.equal(eventPayload(h, 'group_call:answer').sdp, 'answer-sdp');
  assert.ok(
    !h.emitted.some((entry) => entry.event === 'group_call:offer'),
    'the joiner must never offer',
  );
});

test('ICE is queued per peer until the remote description is set', async () => {
  const h = harness();
  h.controller.join('g1', 'mesh');
  h.controller.roster({ groupId: 'g1', peers: [{ userId: 'u2', username: 'bob' }] });
  await tick();

  await h.controller.ice({
    groupId: 'g1',
    from: 'u2',
    fromUsername: 'bob',
    candidate: '{"candidate":"early"}',
  });
  assert.equal(h.pcs.length, 0, 'no peer connection yet');

  await h.controller.offer({
    groupId: 'g1',
    from: 'u2',
    fromUsername: 'bob',
    sdp: 'remote-offer',
  });

  assert.deepEqual(h.pcs[0]?.candidates, [{ candidate: 'early' }]);
});

test('ICE candidates are addressed to the peer username', async () => {
  const h = harness();
  h.controller.join('g1', 'mesh');
  h.controller.roster({ groupId: 'g1', peers: [] });
  await h.controller.joined({ groupId: 'g1', from: 'u2', fromUsername: 'bob' });

  // The server resolves `to` with getUserByUsername, so a userId here would
  // silently drop every candidate.
  h.pcs[0]?.handlers.onIceCandidate?.({ candidate: 'c1' });
  assert.equal(eventPayload(h, 'group_call:ice').to, 'bob');
  assert.equal(eventPayload(h, 'group_call:ice').candidate, '{"candidate":"c1"}');
});

test('leave closes every peer connection, stops capture and emits leave', async () => {
  const h = harness();
  h.controller.join('g1', 'mesh');
  h.controller.roster({ groupId: 'g1', peers: [] });
  await h.controller.joined({ groupId: 'g1', from: 'u2', fromUsername: 'bob' });
  assert.equal(h.pcs.length, 1);

  h.controller.leave();

  assert.equal(h.pcs[0]?.closed, true);
  assert.equal(h.allStopped(), true);
  assert.equal(eventPayload(h, 'group_call:leave').groupId, 'g1');
  assert.equal(lastSnapshot(h).state, 'idle');
  assert.deepEqual(lastSnapshot(h).peers, []);
});

test('group_call:left closes and removes only the leaving peer', async () => {
  const h = harness();
  h.controller.join('g1', 'mesh');
  h.controller.roster({ groupId: 'g1', peers: [] });
  await h.controller.joined({ groupId: 'g1', from: 'u2', fromUsername: 'bob' });

  h.controller.left({ groupId: 'g1', from: 'u2', fromUsername: 'bob' });

  assert.equal(h.pcs[0]?.closed, true);
  assert.deepEqual(lastSnapshot(h).peers, []);
  assert.equal(lastSnapshot(h).state, 'active');
});

test('an SFU room requests a token instead of joining the mesh roster', () => {
  const h = harness();
  h.controller.join('g1', 'sfu');

  const events = h.emitted.map((entry) => entry.event);
  assert.deepEqual(events, ['group_call:sfu_token']);
  assert.ok(!events.includes('group_call:join'));
  assert.equal(lastSnapshot(h).topology, 'sfu');
});

test('a joiner that is not in a call keeps a pc-less indicator', async () => {
  const h = harness();
  await h.controller.joined({ groupId: 'g1', from: 'u2', fromUsername: 'bob' });

  const snapshot = lastSnapshot(h);
  assert.equal(snapshot.state, 'idle');
  assert.equal(snapshot.peers.length, 1);
  assert.equal(snapshot.peers[0]?.pc, undefined);
  assert.equal(h.pcs.length, 0);
  assert.deepEqual(h.errors, []);
});
