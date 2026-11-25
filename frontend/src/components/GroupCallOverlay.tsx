import { useEffect, useRef } from 'react';
import type { GroupCallPeer, GroupCallPhase } from '../lib/group-calls';
import type { CallTopology } from '../types';

type GroupCallOverlayProps = {
  readonly groupName: string;
  readonly state: GroupCallPhase;
  readonly topology: CallTopology;
  readonly peers: readonly GroupCallPeer[];
  readonly localStream: MediaStream | null;
  readonly onLeave: () => void;
};

type StreamVideoProps = {
  readonly stream: MediaStream;
  readonly muted: boolean;
};

function StreamVideo({ stream, muted }: StreamVideoProps) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element !== null) element.srcObject = stream;
    return () => {
      if (element !== null) element.srcObject = null;
    };
  }, [stream]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className="h-full w-full object-cover"
      aria-label={muted ? 'Your camera' : 'Remote camera'}
    />
  );
}

function PeerTile({ peer }: { readonly peer: GroupCallPeer }) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
      {peer.stream !== undefined ? (
        <StreamVideo stream={peer.stream} muted={false} />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span className="text-2xl font-semibold text-zinc-600">
            {peer.username.slice(0, 1).toUpperCase()}
          </span>
        </div>
      )}
      <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-zinc-100">
        {peer.username}
      </span>
    </div>
  );
}

// Full-body call surface, styled like the 1:1 call row's dark/emerald/rose
// language. Mesh peers carry a MediaStream; the SFU bridge exposes the same
// shape by wrapping each subscribed camera track in a MediaStream.
export function GroupCallOverlay({
  groupName,
  state,
  topology,
  peers,
  localStream,
  onLeave,
}: GroupCallOverlayProps) {
  const participantCount = peers.length + 1;
  const noun = participantCount === 1 ? 'participant' : 'participants';

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-zinc-950/95 backdrop-blur-sm">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800/60 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-100">{groupName}</p>
          <p className="text-xs text-zinc-500" aria-live="polite">
            {state === 'joining'
              ? 'Joining call…'
              : `In call · ${participantCount} ${noun} · ${topology === 'sfu' ? 'SFU' : 'Mesh'}`}
          </p>
        </div>
        <button
          type="button"
          data-key="leave-group-call"
          onClick={onLeave}
          className="shrink-0 rounded-lg bg-rose-600/90 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-rose-500"
        >
          Leave call
        </button>
      </div>

      {topology === 'sfu' && (
        <p
          role="note"
          className="shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-200"
        >
          SFU room — this server forwards call media (less private than mesh).
        </p>
      )}

      <div className="relative min-h-0 flex-1 overflow-y-auto p-4">
        {peers.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-zinc-500">
              {state === 'joining' ? 'Joining…' : 'Waiting for participants…'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {peers.map((peer) => (
              <PeerTile key={peer.userId} peer={peer} />
            ))}
          </div>
        )}

        <div className="pointer-events-none absolute bottom-4 right-4 h-24 w-36 overflow-hidden rounded-lg border border-zinc-700/70 bg-zinc-900 shadow-lg sm:h-28 sm:w-44">
          {localStream !== null ? (
            <StreamVideo stream={localStream} muted />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
              Your camera
            </div>
          )}
          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-zinc-200">
            You
          </span>
        </div>
      </div>
    </div>
  );
}
