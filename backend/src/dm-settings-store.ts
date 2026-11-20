import type { UserId } from './types';

export type DmPeer = {
  readonly id: UserId;
  readonly name: string;
};

export type DmSettingsEntry = {
  readonly seconds: number;
  readonly userA: DmPeer;
  readonly userB: DmPeer;
};

// One entry per DM pair, keyed by the sorted userIds so both parties hit
// the same slot no matter who set the timer. Usernames are captured at set
// time — the join-time heal emit reports the peer by that stored name.
function pairKey(a: UserId, b: UserId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export class DmSettingsStore {
  readonly #entries: Map<string, DmSettingsEntry>;

  constructor() {
    this.#entries = new Map();
  }

  // seconds === 0 turns the timer off, which removes the entry entirely.
  set(a: DmPeer, b: DmPeer, seconds: number): void {
    const key = pairKey(a.id, b.id);
    if (seconds === 0) {
      this.#entries.delete(key);
      return;
    }
    const [userA, userB] = a.id <= b.id ? [a, b] : [b, a];
    this.#entries.set(key, { seconds, userA, userB });
  }

  get(a: UserId, b: UserId): DmSettingsEntry | undefined {
    return this.#entries.get(pairKey(a, b));
  }

  // Every entry one side of — used to replay DM timers on join.
  forUser(userId: UserId): readonly DmSettingsEntry[] {
    return [...this.#entries.values()].filter(
      (entry) => entry.userA.id === userId || entry.userB.id === userId,
    );
  }

  destroy(): void {
    this.#entries.clear();
  }
}
