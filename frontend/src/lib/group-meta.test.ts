import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GroupInfo, GroupInfoJson } from '../types';
import {
  applyGroupUpdated,
  buildGroupCreatePayload,
  canCreateGroup,
  canSaveGroupEdit,
  isValidGroupDescription,
  isValidGroupName,
  normalizeGroupInfo,
} from './group-meta';

const GROUP: GroupInfo = {
  groupId: 'grp-1',
  name: 'Team',
  description: '',
  disappearing: 0,
  persistent: false,
  topology: 'mesh',
  members: [{ userId: 'u1', username: 'alice', isAdmin: true }],
  createdBy: 'alice',
  createdAt: 1,
};

test('group name rules: 1..50 after trimming', () => {
  assert.equal(isValidGroupName(''), false);
  assert.equal(isValidGroupName('   '), false, 'whitespace-only names are invalid');
  assert.equal(isValidGroupName('Team'), true);
  assert.equal(isValidGroupName('a'.repeat(50)), true);
  assert.equal(isValidGroupName('a'.repeat(51)), false);
  assert.equal(isValidGroupName('  Team  '), true, 'validation trims first');
});

test('group description rules: 0..256, empty allowed', () => {
  assert.equal(isValidGroupDescription(''), true);
  assert.equal(isValidGroupDescription('x'.repeat(256)), true);
  assert.equal(isValidGroupDescription('x'.repeat(257)), false);
});

test('Save stays disabled until both fields pass', () => {
  assert.equal(canSaveGroupEdit('Team', ''), true);
  assert.equal(canSaveGroupEdit('', 'desc'), false);
  assert.equal(canSaveGroupEdit('Team', 'x'.repeat(257)), false);
  assert.equal(canSaveGroupEdit('a'.repeat(51), 'desc'), false);
});

test('create keeps Submit enabled with an empty description', () => {
  assert.equal(canCreateGroup('Team', ''), true);
  assert.equal(canCreateGroup('', ''), false, 'the name still gates creation');
  assert.equal(canCreateGroup('Team', 'x'.repeat(257)), false);
});

test('normalizeGroupInfo defaults the Tier-3 fields for old servers', () => {
  const json: GroupInfoJson = {
    groupId: 'grp-1',
    name: 'Team',
    members: [],
    createdBy: 'alice',
    createdAt: 1,
  };
  const normalized = normalizeGroupInfo(json);
  assert.equal(normalized.description, '');
  assert.equal(normalized.disappearing, 0);

  const full = normalizeGroupInfo({ ...json, description: 'Notes', disappearing: 86_400 });
  assert.equal(full.description, 'Notes');
  assert.equal(full.disappearing, 86_400);
});

test('group:updated applies full state and preserves everything else', () => {
  const next = applyGroupUpdated([GROUP], {
    groupId: 'grp-1',
    name: 'Renamed',
    description: 'Now with notes',
  });
  assert.equal(next[0]?.name, 'Renamed');
  assert.equal(next[0]?.description, 'Now with notes');
  assert.equal(next[0]?.disappearing, GROUP.disappearing);
  assert.deepEqual(next[0]?.members, GROUP.members);
});

test('normalizeGroupInfo defaults topology to mesh for old servers', () => {
  const json: GroupInfoJson = {
    groupId: 'grp-1',
    name: 'Team',
    members: [],
    createdBy: 'alice',
    createdAt: 1,
  };
  assert.equal(normalizeGroupInfo(json).topology, 'mesh');
  assert.equal(normalizeGroupInfo({ ...json, topology: 'sfu' }).topology, 'sfu');
});

test('group:updated applies topology without dropping the other fields', () => {
  const next = applyGroupUpdated([GROUP], {
    groupId: 'grp-1',
    name: 'Team',
    description: '',
    topology: 'sfu',
  });
  assert.equal(next[0]?.topology, 'sfu');
  assert.deepEqual(next[0]?.members, GROUP.members);
});

test('group:updated keeps topology when an old server omits it', () => {
  const next = applyGroupUpdated([GROUP], {
    groupId: 'grp-1',
    name: 'Team',
    description: '',
  });
  assert.equal(next[0]?.topology, 'mesh');
});

test('group:create payload carries the chosen topology', () => {
  assert.deepEqual(buildGroupCreatePayload('Team', ['bob'], undefined, false, 'mesh'), {
    name: 'Team',
    members: ['bob'],
    topology: 'mesh',
  });
  assert.equal(buildGroupCreatePayload('Team', ['bob'], 'Notes', true, 'sfu').topology, 'sfu');
});

test('group:updated for an unknown group is ignored', () => {
  const input = [GROUP];
  const next = applyGroupUpdated(input, {
    groupId: 'ghost',
    name: 'Nope',
    description: 'Nope',
  });
  // Same reference: the reducer can skip the state swap.
  assert.equal(next, input);
});
