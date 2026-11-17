// ── Expiry: ingestion gate + periodic purge (spec C) ──
// Every decision lives here so the node test harness can drive it with a
// fake clock; ChatContext only wires the interval and the reducer call.

import type { DecryptedGroupMessage, DecryptedMessage, UnreadEntry } from '../types';
import { conversationKeyOfMessage } from './conversation';
import { clearPurgedPins, type PinMap } from './pins';

// One sweeper pass drops expired messages; exported so the wiring test can
// shrink the cadence instead of waiting ten real seconds.
export const PURGE_INTERVAL_MS = 10_000;

// The expiry sweeper: a plain interval so wiring stays testable and the
// cleanup is a single function the provider returns from its effect.
export function startPurgeInterval(
  run: (nowMs: number) => void,
  intervalMs: number = PURGE_INTERVAL_MS,
): () => void {
  const id = setInterval(() => run(Date.now()), intervalMs);
  return () => clearInterval(id);
}

// Ingestion gate (spec C): `exp <= now` at receive time drops the message
// entirely — not stored, no unread/mention bump. A null (absent or
// malformed, already dropped by the parser) or future expiry stores fine.
export function shouldStoreAtIngestion(
  expiresAt: number | null | undefined,
  nowMs: number,
): boolean {
  if (expiresAt === null || expiresAt === undefined) return true;
  return expiresAt > nowMs;
}

// Past-or-now expiry at sweep time: remove from every store.
export function isExpiredAt(
  message: { readonly expiresAt?: number | undefined },
  nowMs: number,
): boolean {
  return typeof message.expiresAt === 'number' && message.expiresAt <= nowMs;
}

export type PurgableState = {
  readonly messages: readonly DecryptedMessage[];
  readonly groupMessages: readonly DecryptedGroupMessage[];
  readonly unread: Readonly<Record<string, UnreadEntry>>;
  readonly pins: PinMap;
};

// One purge pass. Returns the input unchanged (same reference) when nothing
// expired, so the reducer can skip the state swap. Unread counts drop by the
// purged incoming messages of their conversation, floored at zero; a count
// that reaches zero also clears its mention flag (a flag for a count > 0
// stays sticky until the conversation is opened, matching CLEAR_UNREAD).
export function purgeExpired(state: PurgableState, nowMs: number): PurgableState {
  const messages = state.messages.filter((m) => !isExpiredAt(m, nowMs));
  const groupMessages = state.groupMessages.filter((m) => !isExpiredAt(m, nowMs));
  const keptIds = new Set<string>();
  for (const message of messages) keptIds.add(message.id);
  for (const message of groupMessages) keptIds.add(message.id);

  const purged: (DecryptedMessage | DecryptedGroupMessage)[] = [];
  for (const message of state.messages) {
    if (!keptIds.has(message.id)) purged.push(message);
  }
  for (const message of state.groupMessages) {
    if (!keptIds.has(message.id)) purged.push(message);
  }
  if (purged.length === 0) return state;

  const purgedIds = new Set<string>();
  const unread = { ...state.unread };
  let unreadChanged = false;
  for (const message of purged) {
    purgedIds.add(message.id);
    // Own messages never raised an unread count, so only incoming ones
    // decrement their conversation's entry. Read the accumulator, not the
    // input: several purged messages can share one conversation.
    if (message.isOwn) continue;
    const key = conversationKeyOfMessage(message);
    const entry = unread[key];
    if (entry === undefined) continue;
    const count = Math.max(0, entry.count - 1);
    unread[key] = { count, mention: count === 0 ? false : entry.mention };
    unreadChanged = true;
  }

  return {
    messages,
    groupMessages,
    unread: unreadChanged ? unread : state.unread,
    // A pin pointing at a purged message must not survive the sweep.
    pins: clearPurgedPins(state.pins, purgedIds),
  };
}
