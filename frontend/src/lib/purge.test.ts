import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DecryptedGroupMessage, DecryptedMessage, UnreadEntry } from '../types';
import { purgeExpired, shouldStoreAtIngestion, startPurgeInterval } from './purge';

const NOW = 1_700_000_000_000;

function dm(overrides: Partial<DecryptedMessage>): DecryptedMessage {
  return {
    id: 'm1',
    from: 'u-alice',
    fromUsername: 'alice',
    to: 'u-bob',
    toUsername: 'bob',
    plaintext: '{}',
    body: 'hello',
    reply: null,
    edited: false,
    deleted: false,
    timestamp: NOW - 10_000,
    isOwn: false,
    decryptionFailed: false,
    media: null,
    poll: null,
    ...overrides,
  };
}

function groupMessage(overrides: Partial<DecryptedGroupMessage>): DecryptedGroupMessage {
  return {
    id: 'g1',
    groupId: 'grp-1',
    from: 'u-alice',
    fromUsername: 'alice',
    plaintext: '{}',
    body: 'hello group',
    reply: null,
    edited: false,
    deleted: false,
    timestamp: NOW - 10_000,
    isOwn: false,
    decryptionFailed: false,
    media: null,
    poll: null,
    ...overrides,
  };
}

test('ingestion gate: future or absent expiry stores, past drops', () => {
  assert.equal(shouldStoreAtIngestion(null, NOW), true);
  assert.equal(shouldStoreAtIngestion(undefined, NOW), true);
  assert.equal(shouldStoreAtIngestion(NOW + 1, NOW), true);
  assert.equal(shouldStoreAtIngestion(NOW, NOW), false);
  assert.equal(shouldStoreAtIngestion(NOW - 1, NOW), false);
});

test('purge removes expired DM and group messages and keeps the rest', () => {
  const state = {
    messages: [
      dm({ id: 'expired', expiresAt: NOW - 1 }),
      dm({ id: 'live', expiresAt: NOW + 60_000 }),
      dm({ id: 'never' }),
    ],
    groupMessages: [groupMessage({ id: 'g-expired', expiresAt: NOW - 1 })],
    unread: {} as Readonly<Record<string, UnreadEntry>>,
    pins: {} as Readonly<Record<string, string>>,
  };
  const next = purgeExpired(state, NOW);
  assert.deepEqual(
    next.messages.map((m) => m.id),
    ['live', 'never'],
  );
  assert.deepEqual(next.groupMessages, []);
});

test('purge recomputes unread: decrements, floors at zero, clears mention', () => {
  const state = {
    messages: [dm({ id: 'a', expiresAt: NOW - 1 }), dm({ id: 'b', expiresAt: NOW - 1 })],
    groupMessages: [] as DecryptedGroupMessage[],
    // Incoming messages from alice key their conversation as dm:alice.
    unread: {
      'dm:alice': { count: 2, mention: true },
      'dm:carol': { count: 0, mention: false },
    } as Readonly<Record<string, UnreadEntry>>,
    pins: {} as Readonly<Record<string, string>>,
  };
  const next = purgeExpired(state, NOW);
  // Two incoming messages purged from a count of 2: the entry hits zero and
  // the mention flag goes with it.
  assert.deepEqual(next.unread['dm:alice'], { count: 0, mention: false });
});

test('purge floors unread at zero even when the count was smaller', () => {
  const state = {
    messages: [dm({ id: 'a', expiresAt: NOW - 1 }), dm({ id: 'b', expiresAt: NOW - 1 })],
    groupMessages: [] as DecryptedGroupMessage[],
    unread: { 'dm:alice': { count: 1, mention: false } } as Readonly<Record<string, UnreadEntry>>,
    pins: {} as Readonly<Record<string, string>>,
  };
  const next = purgeExpired(state, NOW);
  assert.deepEqual(next.unread['dm:alice'], { count: 0, mention: false });
});

test('purge clears a pin that pointed at a purged message', () => {
  const state = {
    messages: [dm({ id: 'expired', expiresAt: NOW - 1 }), dm({ id: 'kept', isOwn: true })],
    groupMessages: [] as DecryptedGroupMessage[],
    unread: {} as Readonly<Record<string, UnreadEntry>>,
    pins: { 'dm:bob': 'expired', 'group:grp-1': 'kept' } as Readonly<Record<string, string>>,
  };
  const next = purgeExpired(state, NOW);
  assert.equal(next.pins['dm:bob'], undefined);
  assert.equal(next.pins['group:grp-1'], 'kept');
});

test('purge is a no-op (same references) when nothing expired', () => {
  const state = {
    messages: [dm({ id: 'live', expiresAt: NOW + 60_000 })],
    groupMessages: [] as DecryptedGroupMessage[],
    unread: { 'dm:bob': { count: 1, mention: true } } as Readonly<Record<string, UnreadEntry>>,
    pins: { 'dm:bob': 'live' } as Readonly<Record<string, string>>,
  };
  const next = purgeExpired(state, NOW);
  assert.equal(next, state);
});

test('interval wiring calls the sweep with the current clock and stops', async () => {
  const seen: number[] = [];
  const stop = startPurgeInterval((nowMs) => seen.push(nowMs), 5);
  await new Promise((resolve) => setTimeout(resolve, 40));
  stop();
  assert.ok(seen.length >= 2, `expected repeated sweeps, got ${seen.length}`);
  for (const at of seen) assert.ok(Math.abs(at - Date.now()) < 5_000);

  const stopped = seen.length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(seen.length, stopped, 'the disposer must stop the sweeper');
});
