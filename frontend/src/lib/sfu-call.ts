// ── LiveKit SFU bridge ─────────────────────────────────────────────────
// Kept in its own module so the mesh path (and the node test bundle) never
// pulls the browser-only LiveKit client into its graph. The group-call
// controller imports this dynamically when `group_call:sfu_credentials`
// arrives.

import { type RemoteParticipant, Room, RoomEvent, Track } from 'livekit-client';

export type SfuPeer = {
  readonly userId: string;
  readonly username: string;
  readonly stream: MediaStream | null;
};

export type SfuConnectParams = {
  readonly groupId: string;
  readonly url: string;
  readonly token: string;
  readonly onPeers: (peers: readonly SfuPeer[]) => void;
  readonly onDisconnected: () => void;
};

export type SfuHandle = {
  readonly disconnect: () => Promise<void>;
  readonly localStream: () => MediaStream | null;
};

// Bundle every subscribed track (camera + microphone) into one MediaStream so
// the existing <video> tile plays remote audio as well as video.
function streamOf(participant: RemoteParticipant): MediaStream | null {
  const tracks: MediaStreamTrack[] = [];
  for (const publication of participant.trackPublications.values()) {
    const track = publication.track;
    if (track !== undefined) tracks.push(track.mediaStreamTrack);
  }
  if (tracks.length === 0) return null;
  return new MediaStream(tracks);
}

function snapshot(room: Room): readonly SfuPeer[] {
  return Array.from(room.remoteParticipants.values()).map((participant) => ({
    userId: participant.identity,
    username:
      participant.name !== undefined && participant.name.length > 0
        ? participant.name
        : participant.identity,
    stream: streamOf(participant),
  }));
}

export async function connectSfuRoom(params: SfuConnectParams): Promise<SfuHandle> {
  const room = new Room();
  const emitPeers = () => {
    params.onPeers(snapshot(room));
  };

  room.on(RoomEvent.ParticipantConnected, emitPeers);
  room.on(RoomEvent.ParticipantDisconnected, emitPeers);
  room.on(RoomEvent.TrackSubscribed, emitPeers);
  room.on(RoomEvent.TrackUnsubscribed, emitPeers);
  room.on(RoomEvent.Disconnected, params.onDisconnected);

  await room.connect(params.url, params.token);
  await room.localParticipant.setMicrophoneEnabled(true);
  await room.localParticipant.setCameraEnabled(true);
  emitPeers();

  const localStream = (): MediaStream | null => {
    const publication = room.localParticipant.getTrackPublication(Track.Source.Camera);
    const track = publication?.track;
    if (track === undefined) return null;
    return new MediaStream([track.mediaStreamTrack]);
  };

  return {
    disconnect: async () => {
      await room.disconnect();
    },
    localStream,
  };
}
