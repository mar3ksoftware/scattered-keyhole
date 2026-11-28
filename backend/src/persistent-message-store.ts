import type { Database } from 'bun:sqlite';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Server-side store for messages in persistent rooms (Item 7).
// Stores the raw ciphertext payload (opaque to the server) plus media blobs on
// disk so history survives restarts. Only persistent rooms use this store.

export type StoredMessage = {
  readonly id: string;
  readonly groupId: string;
  readonly from: string;
  readonly fromUsername: string;
  readonly ciphertexts: readonly {
    readonly to: string;
    readonly ciphertext: string;
    readonly iv: string;
  }[];
  readonly timestamp: number;
  readonly expiresAt: number | null;
};

export type RoomSettings = {
  readonly groupId: string;
  readonly persistent: boolean;
  readonly updatedAt: number;
  readonly updatedBy: string;
};

export class PersistentMessageStore {
  readonly #db: Database;
  readonly #mediaDir: string;
  readonly #maxMessagesPerRoom: number;

  constructor(db: Database, mediaDir: string, maxMessagesPerRoom: number) {
    this.#db = db;
    this.#mediaDir = mediaDir;
    this.#maxMessagesPerRoom = maxMessagesPerRoom;
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS room_messages (
        id            TEXT PRIMARY KEY,
        group_id      TEXT NOT NULL,
        from_user     TEXT NOT NULL,
        from_username TEXT NOT NULL,
        payload_json  TEXT NOT NULL,
        timestamp     INTEGER NOT NULL,
        expires_at    INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_room_messages_group ON room_messages(group_id, timestamp);
      CREATE TABLE IF NOT EXISTS room_settings (
        group_id      TEXT PRIMARY KEY,
        persistent    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        updated_by    TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS read_cursors (
        group_id      TEXT NOT NULL,
        user_id       TEXT NOT NULL,
        last_seen_id  TEXT,
        updated_at    INTEGER NOT NULL,
        PRIMARY KEY (group_id, user_id)
      );
    `);
    if (process.env['WIPE_ON_STARTUP'] === '1') {
      try {
        const { rmSync } = require('node:fs');
        rmSync(mediaDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
    try {
      mkdirSync(mediaDir, { recursive: true });
    } catch {
      // Directory may already exist.
    }
  }

  // ── Room settings ──────────────────────────────────────────────────

  getSettings(groupId: string): RoomSettings | undefined {
    const row = this.#db
      .query('SELECT group_id, persistent, updated_at, updated_by FROM room_settings WHERE group_id = ?')
      .get(groupId) as
      | { group_id: string; persistent: number; updated_at: number; updated_by: string }
      | undefined;
    if (row === undefined || row === null) return undefined;
    return {
      groupId: row.group_id,
      persistent: row.persistent === 1,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  }

  setSettings(groupId: string, persistent: boolean, updatedBy: string): RoomSettings {
    const now = Date.now();
    this.#db.run(
      'INSERT OR REPLACE INTO room_settings (group_id, persistent, updated_at, updated_by) VALUES (?, ?, ?, ?)',
      [groupId, persistent ? 1 : 0, now, updatedBy],
    );
    return { groupId, persistent, updatedAt: now, updatedBy };
  }

  isPersistent(groupId: string): boolean {
    return this.getSettings(groupId)?.persistent === true;
  }

  // ── Messages ───────────────────────────────────────────────────────

  store(msg: StoredMessage): void {
    // Enforce per-room cap: drop oldest if exceeded.
    const count = this.#db
      .query('SELECT COUNT(*) AS n FROM room_messages WHERE group_id = ?')
      .get(msg.groupId) as { n: number };
    if (count.n >= this.#maxMessagesPerRoom) {
      const oldest = this.#db
        .query('SELECT id FROM room_messages WHERE group_id = ? ORDER BY timestamp ASC LIMIT 1')
        .get(msg.groupId) as { id: string } | undefined;
      if (oldest !== undefined && oldest !== null) {
        this.deleteMessage(msg.groupId, oldest.id);
      }
    }
    this.#db.run(
      'INSERT OR REPLACE INTO room_messages (id, group_id, from_user, from_username, payload_json, timestamp, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        msg.id,
        msg.groupId,
        msg.from,
        msg.fromUsername,
        JSON.stringify(msg.ciphertexts),
        msg.timestamp,
        msg.expiresAt,
      ],
    );
  }

  forGroup(groupId: string, sinceTimestamp = 0): StoredMessage[] {
    const rows = this.#db
      .query(
        'SELECT id, group_id, from_user, from_username, payload_json, timestamp, expires_at FROM room_messages WHERE group_id = ? AND timestamp >= ? ORDER BY timestamp ASC',
      )
      .all(groupId, sinceTimestamp) as {
      id: string;
      group_id: string;
      from_user: string;
      from_username: string;
      payload_json: string;
      timestamp: number;
      expires_at: number | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      groupId: r.group_id,
      from: r.from_user,
      fromUsername: r.from_username,
      ciphertexts: JSON.parse(r.payload_json) as StoredMessage['ciphertexts'],
      timestamp: r.timestamp,
      expiresAt: r.expires_at,
    }));
  }

  deleteMessage(groupId: string, messageId: string): void {
    this.#db.run('DELETE FROM room_messages WHERE group_id = ? AND id = ?', [groupId, messageId]);
    // Best-effort media blob cleanup.
    const blobPath = join(this.#mediaDir, messageId);
    try {
      if (existsSync(blobPath)) unlinkSync(blobPath);
    } catch {
      // Ignore.
    }
  }

  deleteForEveryone(groupId: string, messageId: string): void {
    this.deleteMessage(groupId, messageId);
  }

  // Sweeper: remove expired messages (disappearing timers).
  sweepExpired(now = Date.now()): number {
    const rows = this.#db
      .query('SELECT group_id, id FROM room_messages WHERE expires_at IS NOT NULL AND expires_at <= ?')
      .all(now) as { group_id: string; id: string }[];
    for (const r of rows) {
      this.deleteMessage(r.group_id, r.id);
    }
    return rows.length;
  }

  // ── Read cursors ────────────────────────────────────────────────────

  setCursor(groupId: string, userId: string, lastSeenId: string): void {
    this.#db.run(
      'INSERT OR REPLACE INTO read_cursors (group_id, user_id, last_seen_id, updated_at) VALUES (?, ?, ?, ?)',
      [groupId, userId, lastSeenId, Date.now()],
    );
  }

  getCursor(groupId: string, userId: string): string | null {
    const row = this.#db
      .query('SELECT last_seen_id FROM read_cursors WHERE group_id = ? AND user_id = ?')
      .get(groupId, userId) as { last_seen_id: string | null } | undefined;
    return row?.last_seen_id ?? null;
  }

  // ── Media blobs ─────────────────────────────────────────────────────

  putMedia(mediaId: string, bytes: Uint8Array): 'ok' | 'too_large' {
    const path = join(this.#mediaDir, mediaId);
    try {
      writeFileSync(path, bytes);
      return 'ok';
    } catch {
      return 'too_large';
    }
  }

  getMedia(mediaId: string): Uint8Array | undefined {
    const path = join(this.#mediaDir, mediaId);
    if (!existsSync(path)) return undefined;
    return new Uint8Array(require('node:fs').readFileSync(path));
  }

  destroy(): void {
    this.#db.close();
  }
}
