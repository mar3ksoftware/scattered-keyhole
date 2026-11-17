// ── Pin slot rules (spec B) ──
// Single pin slot per conversation, client-side only — the server relays
// pin actions and gates who may send them. All decision logic lives here so
// the node test harness can exercise it without React.

import type { DecryptedGroupMessage, DecryptedMessage } from '../types';

// What the relay's target looks like in local state right now.
export type PinTargetState = 'missing' | 'present' | 'deleted';

export type PinMap = Readonly<Record<string, string>>;

// Locate the relay target inside the conversation named by `key`. A
// tombstoned target counts as deleted so the banner never resurrects it.
export function pinTargetState(
  key: string,
  targetId: string,
  messages: readonly DecryptedMessage[],
  groupMessages: readonly DecryptedGroupMessage[],
): PinTargetState {
  if (key.startsWith('group:')) {
    const groupId = key.slice('group:'.length);
    const found = groupMessages.find((m) => m.id === targetId && m.groupId === groupId);
    if (found === undefined) return 'missing';
    return found.deleted ? 'deleted' : 'present';
  }
  const peer = key.slice('dm:'.length);
  const found = messages.find(
    (m) => m.id === targetId && (m.fromUsername === peer || m.toUsername === peer),
  );
  if (found === undefined) return 'missing';
  return found.deleted ? 'deleted' : 'present';
}

// Apply one `message:pinned` relay (or an optimistic SET_PIN) to the map.
// Returns the same reference when nothing changes so the reducer can skip
// the state swap — that also makes self-echoes idempotent no-ops.
export function applyPin(
  pins: PinMap,
  key: string,
  targetId: string | null,
  targetState: PinTargetState = 'present',
): PinMap {
  const current = pins[key];
  if (targetId === null) {
    // Unpin is slot-wide (v1): clear the slot whatever it pointed at.
    if (current === undefined) return pins;
    const next = { ...pins };
    delete next[key];
    return next;
  }
  // A pin of an unknown (or tombstoned) target is ignored, never stored.
  if (targetState !== 'present') return pins;
  if (current === targetId) return pins;
  return { ...pins, [key]: targetId };
}

// The message was tombstoned: a pin pointing at it must not survive.
export function clearPinForMessage(pins: PinMap, key: string, targetId: string): PinMap {
  if (pins[key] !== targetId) return pins;
  const next = { ...pins };
  delete next[key];
  return next;
}

// The message was purged by expiry: clear every slot that pointed at it.
export function clearPurgedPins(pins: PinMap, purgedIds: ReadonlySet<string>): PinMap {
  let changed = false;
  const next: Record<string, string> = {};
  for (const [key, targetId] of Object.entries(pins)) {
    if (purgedIds.has(targetId)) {
      changed = true;
      continue;
    }
    next[key] = targetId;
  }
  return changed ? next : pins;
}

// Action-menu entry for one message (spec B UI): the currently pinned
// message offers the unpin label, any other message the pin label, and
// users who may not pin see no entry at all.
export function pinMenuLabel(
  isPinned: boolean,
  canPin: boolean,
): 'Pin message' | 'Unpin message' | null {
  if (!canPin) return null;
  return isPinned ? 'Unpin message' : 'Pin message';
}
