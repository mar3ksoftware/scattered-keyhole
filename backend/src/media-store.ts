import { mkdirSync, readdirSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONSTANTS } from './types';

type MediaEntry = { readonly bytes: Uint8Array; readonly createdAt: number };

type MediaStoreOptions = {
  readonly ttlMs?: number;
  readonly maxFileBytes?: number;
  readonly maxTotalBytes?: number;
  readonly maxFiles?: number;
  readonly sweepIntervalMs?: number;
  readonly now?: () => number;
  readonly diskDir?: string;
  readonly wipeOnStartup?: boolean;
};

export class MediaStore {
  readonly #entries = new Map<string, MediaEntry>();
  readonly #ttlMs: number;
  readonly #maxFileBytes: number;
  readonly #maxTotalBytes: number;
  readonly #maxFiles: number;
  readonly #now: () => number;
  readonly #diskDir: string | undefined;
  #totalBytes = 0;
  #fileCount = 0;
  #sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(opts?: MediaStoreOptions) {
    this.#ttlMs = opts?.ttlMs ?? CONSTANTS.MEDIA_TTL_MS;
    this.#maxFileBytes = opts?.maxFileBytes ?? CONSTANTS.MAX_MEDIA_BYTES + 16;
    this.#maxTotalBytes = opts?.maxTotalBytes ?? CONSTANTS.MAX_MEDIA_TOTAL_BYTES;
    this.#maxFiles = opts?.maxFiles ?? CONSTANTS.MAX_MEDIA_FILES;
    this.#now = opts?.now ?? Date.now;
    this.#diskDir = opts?.diskDir;

    if (this.#diskDir !== undefined) {
      mkdirSync(this.#diskDir, { recursive: true });
      if (opts?.wipeOnStartup === true) {
        try {
          for (const name of readdirSync(this.#diskDir)) {
            try { unlinkSync(join(this.#diskDir, name)); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      }
    }

    const sweepIntervalMs = opts?.sweepIntervalMs ?? CONSTANTS.MEDIA_SWEEP_INTERVAL_MS;
    if (sweepIntervalMs > 0) {
      this.#sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
    }
  }

  #path(id: string): string | undefined {
    if (this.#diskDir === undefined) return undefined;
    const safe = id.replace(/[^a-zA-Z0-9._-]/g, '_');
    return join(this.#diskDir, safe);
  }

  // An expired entry counts as absent; drop it and fix the running totals.
  #takeLive(id: string, now: number): MediaEntry | undefined {
    const entry = this.#entries.get(id);
    if (entry === undefined) {
      // Try disk if available.
      const p = this.#path(id);
      if (p === undefined) return undefined;
      // No metadata in memory for this id (e.g. after restart) — treat as absent.
      return undefined;
    }
    if (now - entry.createdAt >= this.#ttlMs) {
      this.#entries.delete(id);
      this.#totalBytes -= entry.bytes.length;
      this.#fileCount -= 1;
      const p = this.#path(id);
      if (p !== undefined) { try { unlinkSync(p); } catch { /* ignore */ } }
      return undefined;
    }
    return entry;
  }

  put(id: string, bytes: Uint8Array): 'ok' | 'too_large' | 'quota_exceeded' {
    if (bytes.length > this.#maxFileBytes) {
      return 'too_large';
    }

    const now = this.#now();
    const existing = this.#takeLive(id, now);
    const replacedBytes = existing?.bytes.length ?? 0;
    const replacedCount = existing === undefined ? 0 : 1;

    const nextTotal = this.#totalBytes - replacedBytes + bytes.length;
    const nextCount = this.#fileCount - replacedCount + 1;
    if (nextTotal > this.#maxTotalBytes || nextCount > this.#maxFiles) {
      return 'quota_exceeded';
    }

    const p = this.#path(id);
    if (p !== undefined) {
      try { writeFileSync(p, bytes); } catch { return 'quota_exceeded'; }
    }

    this.#entries.set(id, { bytes, createdAt: now });
    this.#totalBytes = nextTotal;
    this.#fileCount = nextCount;
    return 'ok';
  }

  get(id: string): Uint8Array | undefined {
    const entry = this.#takeLive(id, this.#now());
    if (entry === undefined) {
      const p = this.#path(id);
      if (p === undefined) return undefined;
      try { return new Uint8Array(readFileSync(p)); } catch { return undefined; }
    }
    return entry.bytes;
  }

  sweep(): number {
    const now = this.#now();
    let removed = 0;
    for (const [id, entry] of this.#entries) {
      if (now - entry.createdAt >= this.#ttlMs) {
        this.#entries.delete(id);
        this.#totalBytes -= entry.bytes.length;
        this.#fileCount -= 1;
        const p = this.#path(id);
        if (p !== undefined) { try { unlinkSync(p); } catch { /* ignore */ } }
        removed += 1;
      }
    }
    return removed;
  }

  get totalBytes(): number {
    return this.#totalBytes;
  }

  get fileCount(): number {
    return this.#fileCount;
  }

  destroy(): void {
    if (this.#sweepTimer !== undefined) {
      clearInterval(this.#sweepTimer);
      this.#sweepTimer = undefined;
    }
  }
}
