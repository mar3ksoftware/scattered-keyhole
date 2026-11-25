import type { TombstoneEntry } from './types';
import { CONSTANTS } from './types';

type TombstoneStoreOptions = {
  readonly ttlMs?: number;
  readonly cap?: number;
  readonly sweepIntervalMs?: number;
  readonly now?: () => number;
};

export class TombstoneStore {
  readonly #ttlMs: number;
  readonly #cap: number;
  readonly #now: () => number;
  #entries: TombstoneEntry[];
  #sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(opts?: TombstoneStoreOptions) {
    this.#ttlMs = opts?.ttlMs ?? CONSTANTS.TOMBSTONE_TTL_MS;
    this.#cap = opts?.cap ?? CONSTANTS.TOMBSTONE_CAP;
    this.#now = opts?.now ?? Date.now;
    this.#entries = [];

    const sweepIntervalMs = opts?.sweepIntervalMs ?? CONSTANTS.TOMBSTONE_SWEEP_INTERVAL_MS;
    if (sweepIntervalMs > 0) {
      this.#sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
    }
  }

  #conversationKey(entry: TombstoneEntry): string {
    if (entry.groupId !== undefined) return `g:${entry.groupId}`;
    if (entry.to !== undefined) return `d:${entry.to}`;
    return 'global';
  }

  #isExpired(entry: TombstoneEntry, now: number): boolean {
    return now - entry.timestamp >= this.#ttlMs;
  }

  create(entry: Partial<TombstoneEntry> & { readonly messageId: string }): TombstoneEntry {
    const now = this.#now();
    const normalized: TombstoneEntry = {
      messageId: entry.messageId,
      timestamp: entry.timestamp ?? now,
      ...(entry.groupId !== undefined ? { groupId: entry.groupId } : {}),
      ...(entry.to !== undefined ? { to: entry.to } : {}),
    };

    // Drop expired entries first.
    this.#entries = this.#entries.filter((e) => !this.#isExpired(e, now));

    const key = this.#conversationKey(normalized);
    const sameConversation = this.#entries.filter((e) => this.#conversationKey(e) === key);
    if (sameConversation.length >= this.#cap) {
      // Evict the oldest entry in this conversation.
      let oldestIndex = -1;
      let oldestTs = Number.POSITIVE_INFINITY;
      for (let i = 0; i < this.#entries.length; i++) {
        const e = this.#entries[i];
        if (e === undefined) continue;
        if (this.#conversationKey(e) === key && e.timestamp < oldestTs) {
          oldestTs = e.timestamp;
          oldestIndex = i;
        }
      }
      if (oldestIndex !== -1) this.#entries.splice(oldestIndex, 1);
    }

    this.#entries.push(normalized);
    return { ...normalized };
  }

  listFor(filter?: { groupId?: string; to?: string; conversationKey?: string }): TombstoneEntry[] {
    const now = this.#now();
    this.#entries = this.#entries.filter((e) => !this.#isExpired(e, now));

    return this.#entries
      .filter((e) => {
        if (filter === undefined) return true;
        if (filter.groupId !== undefined && e.groupId !== filter.groupId) return false;
        if (filter.to !== undefined && e.to !== filter.to) return false;
        if (
          filter.conversationKey !== undefined &&
          this.#conversationKey(e) !== filter.conversationKey
        )
          return false;
        return true;
      })
      .map((e) => ({ ...e }));
  }

  sweep(): number {
    const now = this.#now();
    const before = this.#entries.length;
    this.#entries = this.#entries.filter((e) => !this.#isExpired(e, now));
    return before - this.#entries.length;
  }

  add(entry: Partial<TombstoneEntry> & { readonly messageId: string }): TombstoneEntry {
    return this.create(entry);
  }
  record(entry: Partial<TombstoneEntry> & { readonly messageId: string }): TombstoneEntry {
    return this.create(entry);
  }
  list(filter?: { groupId?: string; to?: string; conversationKey?: string }): TombstoneEntry[] {
    return this.listFor(filter);
  }

  destroy(): void {
    if (this.#sweepTimer !== undefined) {
      clearInterval(this.#sweepTimer);
      this.#sweepTimer = undefined;
    }
    this.#entries = [];
  }
}
