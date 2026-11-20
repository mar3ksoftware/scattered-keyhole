import { TIMER_OPTIONS } from '../lib/timer';

type ConversationSettingsMenuProps = {
  // Current conversation timer in seconds; one of the presets is checked.
  readonly timerSeconds: number;
  // Groups: visible to all members, only admins may change the value (spec C).
  readonly disabled?: boolean | undefined;
  readonly onSelect: (seconds: number) => void;
  readonly canEditGroup?: boolean | undefined;
  readonly onEditGroup?: (() => void) | undefined;
};

// The header dropdown panel: timer label, the four preset options, and the
// admin-only `Edit group` entry. Split out of ChatHeader so widget tests can
// render it without simulating a click first.
export function ConversationSettingsMenu({
  timerSeconds,
  disabled,
  onSelect,
  canEditGroup,
  onEditGroup,
}: ConversationSettingsMenuProps) {
  return (
    <div
      role="menu"
      aria-label="Disappearing messages"
      className="absolute right-0 top-full z-40 mt-1 w-44 rounded-lg border border-zinc-700/70 bg-zinc-900 p-1 shadow-xl"
    >
      <p className="px-2 py-1 text-xs font-medium text-zinc-500">Disappearing messages</p>
      {TIMER_OPTIONS.map((option) => (
        <button
          key={option.seconds}
          type="button"
          role="menuitemradio"
          aria-checked={timerSeconds === option.seconds}
          disabled={disabled === true}
          onClick={() => onSelect(option.seconds)}
          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800/70 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {option.label}
          {timerSeconds === option.seconds && (
            <span aria-hidden="true" className="text-indigo-400">
              ✓
            </span>
          )}
        </button>
      ))}
      {canEditGroup === true && onEditGroup !== undefined && (
        <button
          type="button"
          onClick={onEditGroup}
          className="mt-1 w-full rounded-md border-t border-zinc-800 px-2 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800/70"
        >
          Edit group
        </button>
      )}
    </div>
  );
}
