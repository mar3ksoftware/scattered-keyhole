import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChat } from '../context/ChatContext';
import { canCreateGroup } from '../lib/group-meta';
import { CONSTANTS } from '../types';

const MAX_GROUP_NAME_LENGTH = CONSTANTS.MAX_GROUP_NAME_LENGTH;
const MAX_GROUP_DESCRIPTION_LENGTH = CONSTANTS.MAX_GROUP_DESCRIPTION_LENGTH;

type CreateGroupFormProps = {
  readonly onClose: () => void;
};

// The dialog itself, free of any portal call so widget tests can render it
// through the server renderer. State resets by unmounting on close.
export function CreateGroupForm({ onClose }: CreateGroupFormProps) {
  const { directory, users, user, createGroup } = useChat();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleMember = useCallback((username: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(username)) {
        next.delete(username);
      } else {
        next.add(username);
      }
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = name.trim();
    if (!canCreateGroup(name, description) || trimmed.length === 0 || selected.size === 0) return;
    createGroup(trimmed, Array.from(selected), description.length > 0 ? description : undefined);
    setName('');
    setDescription('');
    setSelected(new Set());
    onClose();
  }, [name, description, selected, createGroup, onClose]);

  const otherUsers = directory
    .filter((u) => u !== user?.username)
    .slice()
    .sort();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-group-title"
        className="glass w-full max-w-md rounded-2xl p-6 border border-zinc-700/50 max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <h2 id="create-group-title" className="text-lg font-semibold text-zinc-100 mb-4">
          Create Group
        </h2>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Group name"
          maxLength={MAX_GROUP_NAME_LENGTH}
          className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 mb-4"
        />
        <label className="block text-sm text-zinc-400 mb-1" htmlFor="create-group-description">
          Description
        </label>
        <textarea
          id="create-group-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={MAX_GROUP_DESCRIPTION_LENGTH}
          rows={2}
          className="w-full resize-none bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 mb-4"
        />
        <div className="max-h-48 overflow-y-auto mb-4">
          {otherUsers.length === 0 ? (
            <p className="text-sm text-zinc-500">No other users</p>
          ) : (
            otherUsers.map((u) => (
              <label
                key={u}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(u)}
                  onChange={() => toggleMember(u)}
                  className="rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500/50"
                />
                <span className="text-sm text-zinc-300">{u}</span>
                {users.some((c) => c.username === u) ? (
                  <span
                    role="img"
                    aria-label="Online"
                    className="ml-auto h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                  />
                ) : (
                  <span className="ml-auto text-xs text-zinc-500">offline</span>
                )}
              </label>
            ))
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canCreateGroup(name, description) || selected.size === 0}
            className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

type CreateGroupModalProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;
};

// The Sidebar is a `backdrop-filter` element, which makes it the containing
// block for `position: fixed` descendants — portal to <body> so the dialog
// covers the viewport instead of only the sidebar column.
export function CreateGroupModal({ isOpen, onClose }: CreateGroupModalProps) {
  if (!isOpen) return null;
  return createPortal(<CreateGroupForm onClose={onClose} />, document.body);
}
