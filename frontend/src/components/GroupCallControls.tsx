import type { GroupCallPhase } from '../lib/group-calls';

type GroupCallControlsProps = {
  readonly state: GroupCallPhase;
  readonly participantCount: number;
  // Set while a call for another room is live: starting a second call is
  // not possible, so the entry point stays visible but inert.
  readonly disabled?: boolean | undefined;
  readonly onStart: () => void;
  readonly onLeave: () => void;
};

function PhoneIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

// Header entry point for a group call. The labels mirror the 1:1 call row
// ("Call" / "End call") while adding the live participant count.
export function GroupCallControls({
  state,
  participantCount,
  disabled,
  onStart,
  onLeave,
}: GroupCallControlsProps) {
  if (state === 'idle') {
    return (
      <button
        type="button"
        data-key="start-group-call"
        onClick={onStart}
        disabled={disabled === true}
        className="inline-flex min-h-10 shrink-0 touch-manipulation items-center gap-1.5 rounded-lg px-2 text-sm text-emerald-500 transition-colors hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <PhoneIcon />
        Start call
      </button>
    );
  }

  const noun = participantCount === 1 ? 'participant' : 'participants';
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-xs text-zinc-400" aria-live="polite">
        {state === 'joining' ? 'Joining call…' : `In call · ${participantCount} ${noun}`}
      </span>
      <button
        type="button"
        data-key="leave-group-call"
        onClick={onLeave}
        className="inline-flex min-h-10 shrink-0 touch-manipulation items-center rounded-lg px-2 text-sm text-rose-400 transition-colors hover:text-rose-300"
      >
        Leave call
      </button>
    </div>
  );
}
