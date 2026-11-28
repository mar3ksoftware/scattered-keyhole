import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { PersistentMessageStore } from './persistent-message-store';

describe('PersistentMessageStore', () => {
  test('stores and retrieves messages', () => {
    const db = new Database(':memory:');
    const store = new PersistentMessageStore(db, '/tmp/pm-test', 100);
    store.store({
      id: 'm1',
      groupId: 'g1',
      from: 'u1',
      fromUsername: 'alice',
      ciphertexts: [{ to: 'u2', ciphertext: 'ct', iv: 'iv' }],
      timestamp: 1000,
      expiresAt: null,
    });
    const rows = store.forGroup('g1');
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe('m1');
    expect(rows[0]!.ciphertexts[0]!.ciphertext).toBe('ct');
    store.destroy();
  });

  test('per-room cap evicts oldest', () => {
    const db = new Database(':memory:');
    const store = new PersistentMessageStore(db, '/tmp/pm-test', 2);
    for (let i = 0; i < 3; i++) {
      store.store({
        id: `m${i}`,
        groupId: 'g1',
        from: 'u1',
        fromUsername: 'alice',
        ciphertexts: [],
        timestamp: 1000 + i,
        expiresAt: null,
      });
    }
    const rows = store.forGroup('g1');
    expect(rows.length).toBe(2);
    expect(rows[0]!.id).toBe('m1');
    store.destroy();
  });

  test('sweepExpired removes expired messages', () => {
    const db = new Database(':memory:');
    const store = new PersistentMessageStore(db, '/tmp/pm-test', 100);
    store.store({
      id: 'm1',
      groupId: 'g1',
      from: 'u1',
      fromUsername: 'alice',
      ciphertexts: [],
      timestamp: 1000,
      expiresAt: 1500,
    });
    const removed = store.sweepExpired(2000);
    expect(removed).toBe(1);
    expect(store.forGroup('g1').length).toBe(0);
    store.destroy();
  });

  test('room settings round-trip', () => {
    const db = new Database(':memory:');
    const store = new PersistentMessageStore(db, '/tmp/pm-test', 100);
    store.setSettings('g1', true, 'alice');
    expect(store.isPersistent('g1')).toBe(true);
    const s = store.getSettings('g1');
    expect(s?.persistent).toBe(true);
    expect(s?.updatedBy).toBe('alice');
    store.destroy();
  });

  test('deleteForEveryone removes message', () => {
    const db = new Database(':memory:');
    const store = new PersistentMessageStore(db, '/tmp/pm-test', 100);
    store.store({
      id: 'm1',
      groupId: 'g1',
      from: 'u1',
      fromUsername: 'alice',
      ciphertexts: [],
      timestamp: 1000,
      expiresAt: null,
    });
    store.deleteForEveryone('g1', 'm1');
    expect(store.forGroup('g1').length).toBe(0);
    store.destroy();
  });
});
