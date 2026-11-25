import type { GroupId, UserId } from './types';

// Mesh-call membership is ephemeral: it mirrors who currently holds a WebRTC
// session, so nothing here is persisted. A restart or a dropped socket simply
// empties the room, which clients already handle on reconnect.
export class GroupCallRoster {
  #roster: Map<GroupId, Set<UserId>>;

  constructor() {
    this.#roster = new Map();
  }

  participants(groupId: GroupId): readonly UserId[] {
    return Array.from(this.#roster.get(groupId) ?? []);
  }

  size(groupId: GroupId): number {
    return this.#roster.get(groupId)?.size ?? 0;
  }

  has(groupId: GroupId, userId: UserId): boolean {
    return this.#roster.get(groupId)?.has(userId) ?? false;
  }

  // Returns false when the user was already in the call, which lets the join
  // handler treat a repeated join as a no-op.
  add(groupId: GroupId, userId: UserId): boolean {
    const participants = this.#roster.get(groupId);
    if (participants === undefined) {
      this.#roster.set(groupId, new Set([userId]));
      return true;
    }
    if (participants.has(userId)) return false;
    participants.add(userId);
    return true;
  }

  remove(groupId: GroupId, userId: UserId): boolean {
    const participants = this.#roster.get(groupId);
    if (participants === undefined || !participants.has(userId)) return false;
    participants.delete(userId);
    if (participants.size === 0) this.#roster.delete(groupId);
    return true;
  }

  // Disconnect cleanup drops the user from every room and returns the rooms
  // that lost a participant, so the caller can announce each departure.
  removeEverywhere(userId: UserId): readonly GroupId[] {
    const affected: GroupId[] = [];
    for (const [groupId, participants] of this.#roster) {
      if (!participants.delete(userId)) continue;
      affected.push(groupId);
      if (participants.size === 0) this.#roster.delete(groupId);
    }
    return affected;
  }

  destroy(): void {
    this.#roster.clear();
  }
}
