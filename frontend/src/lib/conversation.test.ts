import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DecryptedGroupMessage, DecryptedMessage } from '../types';
import { conversationKeyFor, conversationKeyOfMessage, relayKeyFor } from './conversation';

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

test('conversation keys: dm:<peer> / group:<id>', () => {
  assert.equal(conversationKeyFor({ kind: 'dm', username: 'bob' }), 'dm:bob');
  assert.equal(conversationKeyFor({ kind: 'group', groupId: 'grp-1' }), 'group:grp-1');
});

test('stored messages key on the other party of the conversation', () => {
  // Incoming DM: keyed on the sender.
  assert.equal(conversationKeyOfMessage(dm({})), 'dm:alice');
  // Own DM: keyed on the recipient.
  assert.equal(conversationKeyOfMessage(dm({ isOwn: true })), 'dm:bob');
  // Group messages always key on the group.
  assert.equal(conversationKeyOfMessage(groupMessage({})), 'group:grp-1');
});

test('relayed pin/timer payloads map to the acting conversation', () => {
  // Group scope wins whenever a groupId rides along.
  assert.equal(relayKeyFor({ groupId: 'grp-1', u: 'alice' }, 'bob'), 'group:grp-1');
  // DM relay: `u` is the actor (the other party from our perspective).
  assert.equal(relayKeyFor({ u: 'alice', to: 'bob' }, 'bob'), 'dm:alice');
  // Self-echo shape: our own username as actor, `to` names the peer.
  assert.equal(relayKeyFor({ u: 'bob', to: 'alice' }, 'bob'), 'dm:alice');
});

test('join-heal disappearing:changed carries only the peer', () => {
  // No `u` on the snapshot replay: `to` is the peer of the joining user.
  const heal = { seconds: 86_400, to: 'alice' };
  assert.equal(relayKeyFor(heal, 'bob'), 'dm:alice');
  // Nothing to scope on: no key at all.
  assert.equal(relayKeyFor({}, 'bob'), null);
});
