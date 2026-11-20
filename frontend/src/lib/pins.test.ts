import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DecryptedGroupMessage, DecryptedMessage } from '../types';
import {
  applyPin,
  clearPinForMessage,
  clearPurgedPins,
  pinMenuLabel,
  pinTargetState,
} from './pins';

const KEY = 'dm:bob';

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
    timestamp: 1,
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
    body: 'hello',
    reply: null,
    edited: false,
    deleted: false,
    timestamp: 1,
    isOwn: false,
    decryptionFailed: false,
    media: null,
    poll: null,
    ...overrides,
  };
}

test('a pin of an unknown target is ignored, never stored', () => {
  const pins = {};
  assert.equal(pinTargetState(KEY, 'ghost', [dm({})], []), 'missing');
  assert.equal(applyPin(pins, KEY, 'ghost', 'missing'), pins);
});

test('a pin of a known target replaces the current slot', () => {
  const first = applyPin({}, KEY, 'm1', 'present');
  assert.equal(first[KEY], 'm1');
  const second = applyPin(first, KEY, 'm2', 'present');
  assert.equal(second[KEY], 'm2');
  // The old slot value is gone — one pin per conversation.
  assert.equal(Object.keys(second).length, 1);
});

test('unpin clears the slot whatever it pointed at (slot-wide, v1)', () => {
  const pinned = applyPin({}, KEY, 'm1', 'present');
  const cleared = applyPin(pinned, KEY, null);
  assert.equal(cleared[KEY], undefined);
  // Clearing an already-empty slot is a no-op (same reference).
  assert.equal(applyPin(cleared, KEY, null), cleared);
});

test('a tombstoned target counts as deleted and never lands', () => {
  const messages = [dm({ id: 'm1', deleted: true })];
  assert.equal(pinTargetState(KEY, 'm1', messages, []), 'deleted');
  const pins = applyPin({}, KEY, 'm1', 'deleted');
  assert.equal(pins[KEY], undefined);
});

test('a tombstone clears a pin that pointed at it', () => {
  const pins = applyPin({}, KEY, 'm1', 'present');
  const next = clearPinForMessage(pins, KEY, 'm1');
  assert.equal(next[KEY], undefined);
  // A pin pointing somewhere else is untouched (same reference).
  const other = applyPin({}, KEY, 'm2', 'present');
  assert.equal(clearPinForMessage(other, KEY, 'm1'), other);
});

test('expiry clears every slot that pointed at a purged message', () => {
  const pins = { [KEY]: 'm1', 'group:grp-1': 'g1' };
  const next = clearPurgedPins(pins, new Set(['m1']));
  assert.equal(next[KEY], undefined);
  assert.equal(next['group:grp-1'], 'g1');
  // Nothing matched: same reference.
  assert.equal(clearPurgedPins(pins, new Set(['nope'])), pins);
});

test('a self-echo after the optimistic apply is an idempotent no-op', () => {
  const optimistic = applyPin({}, KEY, 'm1', 'present');
  // The relayed echo repeats the same state; same reference back.
  assert.equal(applyPin(optimistic, KEY, 'm1', 'present'), optimistic);
  // Unpin echo after an optimistic clear likewise changes nothing.
  const cleared = applyPin(optimistic, KEY, null);
  assert.equal(applyPin(cleared, KEY, null, 'missing'), cleared);
});

test('message_rejected rollback restores the previous slot', () => {
  const base = applyPin({}, KEY, 'm1', 'present');
  // Optimistic replace to m2, then the rejection rolls back to m1.
  const optimistic = applyPin(base, KEY, 'm2', 'present');
  assert.equal(optimistic[KEY], 'm2');
  const rolledBack = applyPin(optimistic, KEY, 'm1', 'present');
  assert.equal(rolledBack[KEY], 'm1');
  // Optimistic pin with no previous slot rolls back to an empty slot.
  const fresh = applyPin({}, KEY, 'm3', 'present');
  assert.equal(applyPin(fresh, KEY, null)[KEY], undefined);
});

test('group pins key on the group conversation', () => {
  const key = 'group:grp-1';
  assert.equal(pinTargetState(key, 'g1', [], [groupMessage({})]), 'present');
  assert.equal(pinTargetState(key, 'other', [], [groupMessage({})]), 'missing');
  assert.equal(applyPin({}, key, 'g1', 'present')[key], 'g1');
});

test('action menu labels follow the spec strings exactly', () => {
  assert.equal(pinMenuLabel(false, true), 'Pin message');
  assert.equal(pinMenuLabel(true, true), 'Unpin message');
  // Users who may not pin see no entry at all.
  assert.equal(pinMenuLabel(false, false), null);
  assert.equal(pinMenuLabel(true, false), null);
});
