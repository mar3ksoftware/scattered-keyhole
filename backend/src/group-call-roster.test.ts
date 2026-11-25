import { describe, expect, test } from 'bun:test';
import { GroupCallRoster } from './group-call-roster';
import { GroupId, UserId } from './types';

const GROUP = GroupId('group-1');
const OTHER_GROUP = GroupId('group-2');
const ALICE = UserId('alice');
const BOB = UserId('bob');

describe('GroupCallRoster', () => {
  test('add reports whether the user was new', () => {
    const roster = new GroupCallRoster();
    expect(roster.add(GROUP, ALICE)).toBe(true);
    expect(roster.add(GROUP, ALICE)).toBe(false);
    expect(roster.size(GROUP)).toBe(1);
    expect(roster.has(GROUP, ALICE)).toBe(true);
  });

  test('participants lists the room only', () => {
    const roster = new GroupCallRoster();
    roster.add(GROUP, ALICE);
    roster.add(GROUP, BOB);
    roster.add(OTHER_GROUP, ALICE);

    expect(roster.participants(GROUP)).toEqual([ALICE, BOB]);
    expect(roster.participants(OTHER_GROUP)).toEqual([ALICE]);
  });

  test('remove deletes an empty room', () => {
    const roster = new GroupCallRoster();
    roster.add(GROUP, ALICE);
    expect(roster.remove(GROUP, ALICE)).toBe(true);
    expect(roster.size(GROUP)).toBe(0);
    expect(roster.remove(GROUP, ALICE)).toBe(false);
  });

  test('removeEverywhere returns every affected room', () => {
    const roster = new GroupCallRoster();
    roster.add(GROUP, ALICE);
    roster.add(GROUP, BOB);
    roster.add(OTHER_GROUP, ALICE);

    expect([...roster.removeEverywhere(ALICE)].sort()).toEqual([GROUP, OTHER_GROUP].sort());
    expect(roster.participants(GROUP)).toEqual([BOB]);
    expect(roster.size(OTHER_GROUP)).toBe(0);
  });

  test('removeEverywhere ignores users who are not in a call', () => {
    const roster = new GroupCallRoster();
    roster.add(GROUP, BOB);
    expect(roster.removeEverywhere(ALICE)).toEqual([]);
    expect(roster.participants(GROUP)).toEqual([BOB]);
  });

  test('destroy empties every room', () => {
    const roster = new GroupCallRoster();
    roster.add(GROUP, ALICE);
    roster.destroy();
    expect(roster.size(GROUP)).toBe(0);
  });
});
