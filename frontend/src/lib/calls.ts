// ── WebRTC call helpers (Tier-8) ──────────────────────────────────────

export type CallHandlers = {
  readonly onIceCandidate: (candidate: RTCIceCandidate) => void;
  readonly onTrack: (stream: MediaStream) => void;
  readonly onConnectionStateChange: (state: RTCPeerConnectionState) => void;
};

export function createPeerConnection(handlers: CallHandlers): RTCPeerConnection {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
  pc.onicecandidate = (event) => {
    if (event.candidate !== null) handlers.onIceCandidate(event.candidate);
  };
  pc.ontrack = (event) => {
    const stream = event.streams[0];
    if (stream !== undefined) handlers.onTrack(stream);
  };
  pc.onconnectionstatechange = () => {
    handlers.onConnectionStateChange(pc.connectionState);
  };
  return pc;
}

export async function getUserMedia(audio = true, video = true): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio, video });
}

export function addTracks(pc: RTCPeerConnection, stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    pc.addTrack(track, stream);
  }
}
