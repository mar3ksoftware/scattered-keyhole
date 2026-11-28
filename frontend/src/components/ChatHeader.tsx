import { type ReactNode, useState } from 'react';
import type { CallTopology } from '../types';
import { ConversationSettingsMenu } from './ConversationSettingsMenu';

type ChatHeaderProps = {
  readonly username: string | null;
  readonly subtitle?: string | undefined;
  // Group-call controls live in the header; DMs pass nothing and keep the
  // existing call row inside ChatArea untouched.
  readonly callControls?: ReactNode | undefined;
  readonly onLogout: () => void;
  readonly onBack?: (() => void) | undefined;
  readonly showBack?: boolean | undefined;
  readonly onMembersClick?: (() => void) | undefined;
  // ── Tier-3 settings popover (spec C/A) ──
  // Present only while a conversation is open; the timer control is visible
  // to every member but only enabled where the user may change it.
  readonly timerSeconds?: number | undefined;
  readonly timerDisabled?: boolean | undefined;
  readonly onSelectTimer?: ((seconds: number) => void) | undefined;
  readonly canEditGroup?: boolean | undefined;
  readonly onEditGroup?: (() => void) | undefined;
  // Group call topology shown in the settings menu; the switch is only
  // wired for admins (onSelectTopology undefined otherwise).
  readonly groupTopology?: CallTopology | undefined;
  readonly onSelectTopology?: ((topology: CallTopology) => void) | undefined;
  readonly groupPersistent?: boolean | undefined;
  readonly onSelectPersistent?: ((persistent: boolean) => void) | undefined;
};

function SettingsIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function ChatHeader({
  username,
  subtitle,
  callControls,
  onLogout,
  onBack,
  showBack,
  onMembersClick,
  timerSeconds,
  timerDisabled,
  onSelectTimer,
  canEditGroup,
  onEditGroup,
  groupTopology,
  onSelectTopology,
  groupPersistent,
  onSelectPersistent,
}: ChatHeaderProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const showSettings = onSelectTimer !== undefined;

  const pickTimer = (seconds: number) => {
    setSettingsOpen(false);
    onSelectTimer?.(seconds);
  };

  return (
    <header className="flex min-w-0 shrink-0 items-center gap-2 border-b border-zinc-800/50 px-4 py-3 sm:px-6 sm:py-4">
      {showBack === true && onBack !== undefined && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="-ml-2 inline-flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-200 active:bg-zinc-800 md:hidden"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold text-zinc-100 sm:text-lg">
          {username ?? 'Scattered Keyhole'}
        </h1>
        {subtitle !== undefined && <p className="truncate text-xs text-zinc-500">{subtitle}</p>}
      </div>
      {callControls}
      {onMembersClick !== undefined && (
        <button
          type="button"
          onClick={onMembersClick}
          className="inline-flex min-h-10 shrink-0 touch-manipulation items-center gap-1.5 rounded-lg px-2 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          Members
        </button>
      )}
      {showSettings && (
        <div className="relative">
          <button
            type="button"
            aria-label="Conversation settings"
            aria-haspopup="menu"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((open) => !open)}
            className="inline-flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800/60 hover:text-zinc-300"
          >
            <SettingsIcon />
          </button>
          {settingsOpen && (
            <ConversationSettingsMenu
              timerSeconds={timerSeconds ?? 0}
              disabled={timerDisabled}
              onSelect={pickTimer}
              canEditGroup={canEditGroup}
              topology={groupTopology}
              onSelectTopology={onSelectTopology}
              persistent={groupPersistent}
              onSelectPersistent={onSelectPersistent}
              onEditGroup={
                onEditGroup !== undefined
                  ? () => {
                      setSettingsOpen(false);
                      onEditGroup();
                    }
                  : undefined
              }
            />
          )}
        </div>
      )}
      <button
        type="button"
        onClick={onLogout}
        className="inline-flex min-h-10 shrink-0 touch-manipulation items-center rounded-lg px-2 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
      >
        Logout
      </button>
    </header>
  );
}
