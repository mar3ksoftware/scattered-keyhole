type PinBannerProps = {
  // Excerpt built with the existing reply-excerpt helper (spec B: reuse
  // unchanged — same text for text/poll/media, 140 chars).
  readonly excerpt: string;
  // Only users who may pin see the button; everyone still sees the banner.
  readonly canUnpin: boolean;
  readonly onUnpin: () => void;
  // Best effort: scroll to the pinned message when it is in the loaded list.
  readonly onOpen?: (() => void) | undefined;
};

export function PinBanner({ excerpt, canUnpin, onUnpin, onOpen }: PinBannerProps) {
  return (
    <div
      role="note"
      aria-label="Pinned message"
      className="flex shrink-0 items-center gap-3 border-b border-zinc-800/50 bg-zinc-900/70 px-4 py-2 sm:px-6"
    >
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 truncate text-left text-sm text-zinc-300 transition-colors hover:text-zinc-100"
      >
        {excerpt}
      </button>
      {canUnpin && (
        <button
          type="button"
          onClick={onUnpin}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800/70 hover:text-zinc-200"
        >
          Unpin
        </button>
      )}
    </div>
  );
}
