import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { canSaveGroupEdit } from '../lib/group-meta';
import type { GroupInfo } from '../types';
import { CONSTANTS } from '../types';

type EditGroupModalProps = {
  readonly group: GroupInfo;
  readonly onSave: (name: string, description: string) => void;
  readonly onClose: () => void;
};

// Spec A: name + description edit form; Save stays disabled until both
// fields pass the same limits the server enforces. No optimistic apply —
// `group:updated` carries the full state back.
export function EditGroupModal({ group, onSave, onClose }: EditGroupModalProps) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const canSave = canSaveGroupEdit(name, description);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-group-title"
        className="glass w-full max-w-md rounded-2xl p-6 border border-zinc-700/50"
      >
        <h2 id="edit-group-title" className="text-lg font-semibold text-zinc-100 mb-4">
          Edit group
        </h2>
        <label className="block text-sm text-zinc-400 mb-1" htmlFor="edit-group-name">
          Group name
        </label>
        <input
          id="edit-group-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={CONSTANTS.MAX_GROUP_NAME_LENGTH}
          className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 mb-4"
        />
        <label className="block text-sm text-zinc-400 mb-1" htmlFor="edit-group-description">
          Description
        </label>
        <textarea
          id="edit-group-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={CONSTANTS.MAX_GROUP_DESCRIPTION_LENGTH}
          rows={3}
          className="w-full resize-none bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 mb-4"
        />
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
            onClick={() => onSave(name, description)}
            disabled={!canSave}
            className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
