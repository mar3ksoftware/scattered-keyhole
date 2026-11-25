import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ConversationTarget, GroupInfo } from '../types';
import { expForTimer } from './envelope';
import {
  applyDisappearing,
  embedsExpiry,
  isPresetSeconds,
  TIMER_OPTIONS,
  timerLabelFor,
  timerSecondsOf,
} from './timer';

const GROUP: GroupInfo = {
  groupId: 'grp-1',
  name: 'Team',
  description: '',
  disappearing: 0,
  persistent: false,
  topology: 'mesh',
  members: [],
  createdBy: 'alice',
  createdAt: 1,
};

test('timer options carry the exact spec labels in display order', () => {
  assert.deepEqual(
    TIMER_OPTIONS.map((option) => [option.seconds, option.label]),
    [
      [0, 'Off'],
      [86_400, '24 hours'],
      [604_800, '7 days'],
      [2_592_000, '30 days'],
    ],
  );
  assert.equal(timerLabelFor(86_400), '24 hours');
  assert.equal(timerLabelFor(0), 'Off');
  // Unknown values fall back to Off rather than rendering something odd.
  assert.equal(timerLabelFor(12_345), 'Off');
});

test('preset guard accepts exactly the four frozen values', () => {
  for (const seconds of [0, 86_400, 604_800, 2_592_000]) {
    assert.equal(isPresetSeconds(seconds), true, `${seconds} should be a preset`);
  }
  for (const seconds of [300, -1, 86_401, Number.NaN]) {
    assert.equal(isPresetSeconds(seconds), false, `${seconds} should be rejected`);
  }
});

test('only a timer > 0 embeds exp on outgoing envelopes', () => {
  assert.equal(embedsExpiry(0), false);
  assert.equal(embedsExpiry(86_400), true);

  const now = 1_700_000_000_000;
  assert.equal(expForTimer(0, now), undefined);
  assert.equal(expForTimer(604_800, now), now + 604_800 * 1000);
});

test('timerSecondsOf reads GroupInfo for groups and the map for DMs', () => {
  const dmTarget: ConversationTarget = { kind: 'dm', username: 'bob' };
  const groupTarget: ConversationTarget = { kind: 'group', groupId: 'grp-1' };
  const missingGroup: ConversationTarget = { kind: 'group', groupId: 'nope' };

  assert.equal(timerSecondsOf([], {}, dmTarget), 0);
  assert.equal(timerSecondsOf([], { 'dm:bob': 86_400 }, dmTarget), 86_400);
  assert.equal(timerSecondsOf([{ ...GROUP, disappearing: 604_800 }], {}, groupTarget), 604_800);
  assert.equal(timerSecondsOf([GROUP], {}, missingGroup), 0);
});

test('applyDisappearing updates a DM timer map', () => {
  const state = { groups: [] as readonly GroupInfo[], dmDisappearing: {} };
  const set = applyDisappearing(state, 'dm:bob', 86_400);
  assert.equal(set.dmDisappearing['dm:bob'], 86_400);
  // Same value again: no state change (same references).
  assert.equal(applyDisappearing(set, 'dm:bob', 86_400), set);
  // Clearing at 0 keeps an explicit off value.
  const cleared = applyDisappearing(set, 'dm:bob', 0);
  assert.equal(cleared.dmDisappearing['dm:bob'], 0);
});

test('applyDisappearing updates a known group and ignores unknown ones', () => {
  const state = { groups: [GROUP] as readonly GroupInfo[], dmDisappearing: {} };
  const next = applyDisappearing(state, 'group:grp-1', 2_592_000);
  assert.equal(next.groups[0]?.disappearing, 2_592_000);
  // Other fields survive the update.
  assert.equal(next.groups[0]?.name, 'Team');
  // Same value: same references.
  assert.equal(applyDisappearing(next, 'group:grp-1', 2_592_000), next);
  // Unknown group: untouched.
  assert.equal(applyDisappearing(state, 'group:ghost', 86_400), state);
});
