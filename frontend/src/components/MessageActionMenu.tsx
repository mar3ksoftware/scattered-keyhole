type MessageActionMenuProps = {
  readonly canReply: boolean;
  readonly canReact: boolean;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  // From lib/pinMenuLabel: `Pin message` / `Unpin message` / null (spec B).
  readonly pinLabel: 'Pin message' | 'Unpin message' | null;
  readonly onReply: () => void;
  readonly onReact: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onPin: () => void;
};

// The hover menu's entries (reply/react/edit/pin/delete). Split out of
// MessageBubble so widget tests can render the entries without a click.
export function MessageActionMenu({
  canReply,
  canReact,
  canEdit,
  canDelete,
  pinLabel,
  onReply,
  onReact,
  onEdit,
  onDelete,
  onPin,
}: MessageActionMenuProps) {
  return (
    <>
      <button
        type="button"
        onClick={onReply}
        disabled={!canReply}
        className="w-full px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800/70 rounded-md disabled:opacity-40"
      >
        Reply
      </button>
      <button
        type="button"
        onClick={onReact}
        disabled={!canReact}
        className="w-full px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800/70 rounded-md disabled:opacity-40"
      >
        React
      </button>
      {canEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="w-full px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800/70 rounded-md"
        >
          Edit
        </button>
      )}
      {pinLabel !== null && (
        <button
          type="button"
          onClick={onPin}
          className="w-full px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800/70 rounded-md"
        >
          {pinLabel}
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="w-full px-3 py-1.5 text-left text-sm text-rose-400 hover:bg-zinc-800/70 rounded-md"
        >
          Delete
        </button>
      )}
    </>
  );
}
