import type { Database } from 'bun:sqlite';

// Server-side store for messages in persistent rooms (Tier-7).
// Stores the raw ciphertext payload (opaque to the server) so it can be
// replayed to members who rejoin. Only persistent rooms use this store.

export type StoredMessage = {
  readonly id: string;
  readonly groupId: string;
  readonly from: string;
  readonly fromUsername: string;
  readonly ciphertexts: readonly { readonly to: string; readonly ciphertext: string; readonly iv: string }[];
  readonly timestamp: number;
};

export class MessageStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS room_messages (
        id            TEXT PRIMARY KEY,
        group_id      TEXT NOT NULL,
        from_user     TEXT NOT NULL,
        from_username TEXT NOT NULL,
        payload_json  TEXT NOT NULL,
        timestamp     INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_room_messages_group ON room_messages(group_id, timestamp);
    `);
  }

  store(msg: StoredMessage): void {
    this.#db.run(
      'INSERT OR REPLACE INTO room_messages (id, group_id, from_user, from_username, payload_json, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      [msg.id, msg.groupId, msg.from, msg.fromUsername, JSON.stringify(msg.ciphertexts), msg.timestamp],
    );
  }

  forGroup(groupId: string): StoredMessage[] {
    const rows = this.#db
      .query('SELECT id, group_id, from_user, from_username, payload_json, timestamp FROM room_messages WHERE group_id = ? ORDER BY timestamp ASC')
      .all(groupId) as { id: string; group_id: string; from_user: string; from_username: string; payload_json: string; timestamp: number }[];
    return rows.map((r) => ({
      id: r.id,
      groupId: r.group_id,
      from: r.from_user,
      fromUsername: r.from_username,
      ciphertexts: JSON.parse(r.payload_json) as StoredMessage['ciphertexts'],
      timestamp: r.timestamp,
    }));
  }

  destroy(): void {
    // nothing
  }
}
