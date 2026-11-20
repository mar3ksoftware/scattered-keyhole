// ── Conversation key space (Tier-3) ──
// One key space for unread, pins and DM timers: dm:<peer> / group:<id>.
// Kept pure so the node test harness can cover the mapping rules.

import type { ConversationTarget, DecryptedGroupMessage, DecryptedMessage } from '../types';

export function conversationKeyFor(target: ConversationTarget): string {
  return target.kind === 'dm' ? `dm:${target.username}` : `group:${target.groupId}`;
}

// The conversation a stored message belongs to — the peer is always "the
// other party", so own messages key on their recipient.
export function conversationKeyOfMessage(
  message: DecryptedMessage | DecryptedGroupMessage,
): string {
  if ('groupId' in message) return `group:${message.groupId}`;
  return `dm:${message.isOwn ? message.toUsername : message.fromUsername}`;
}

// Scope of a relayed Tier-3 payload → conversation key. Relays carry the
// receiver as `to` plus the acting username as `u`; the join-time heal emit
// carries only the timer's peer in `to` (no `u`). Both shapes handled.
export function relayKeyFor(
  scope: {
    readonly u?: string | undefined;
    readonly to?: string | undefined;
    readonly groupId?: string | undefined;
  },
  myUsername: string | undefined,
): string | null {
  if (scope.groupId !== undefined) return `group:${scope.groupId}`;
  if (scope.to !== undefined && (scope.u === undefined || scope.u === myUsername)) {
    return `dm:${scope.to}`;
  }
  if (scope.u !== undefined) return `dm:${scope.u}`;
  if (scope.to !== undefined) return `dm:${scope.to}`;
  return null;
}
