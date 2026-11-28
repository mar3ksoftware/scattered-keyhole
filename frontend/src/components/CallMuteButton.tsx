type CallMuteButtonProps = {
  readonly muted: boolean;
  readonly onToggle: () => void;
};

// 1:1 call mic toggle. With PTT/PTM bound this sets the baseline mute state;
// the bound key adds to it. Split out so widget tests can render it directly.
export function CallMuteButton({ muted, onToggle }: CallMuteButtonProps) {
  return (
    <button
      type="button"
      data-key="mute-toggle"
      aria-pressed={muted}
      aria-label={muted ? 'Microphone muted' : 'Microphone live'}
      onClick={onToggle}
      className={`text-xs transition-colors ${
        muted ? 'text-rose-400 hover:text-rose-300' : 'text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {muted ? 'Unmute mic' : 'Mute mic'}
    </button>
  );
}
