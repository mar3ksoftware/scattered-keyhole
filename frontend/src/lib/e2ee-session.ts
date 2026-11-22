// ── E2EE session manager ───────────────────────────────────────────────
// Manages ECDH keypair + per-peer AES-GCM shared keys.
// Adapted from backend/src/e2ee-session.ts for browser use.

import {
  deriveSharedKey,
  decrypt as e2eeDecrypt,
  encrypt as e2eeEncrypt,
  exportKeyPairJwk,
  exportPublicKey,
  generateKeyPair,
  generatePqKeyPair,
  importKeyPairJwk,
  importPublicKey,
  pqDecapsulate,
  pqEncapsulate,
} from './e2ee';

export class E2eeSession {
  #keyPair: CryptoKeyPair | undefined;
  #keyPairPromise: Promise<CryptoKeyPair> | undefined;
  #sharedKeys: Map<string, CryptoKey>;
  #peerPublicKeys: Map<string, string>;
  #pqKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array } | undefined;

  constructor() {
    this.#keyPair = undefined;
    this.#keyPairPromise = undefined;
    this.#sharedKeys = new Map();
    this.#peerPublicKeys = new Map();
    this.#pqKeyPair = undefined;
  }

  // Serialize keypair generation: multiple public-key exchanges can start
  // concurrently, and they must all use the same keypair.
  async #loadPersistedKeyPair(): Promise<CryptoKeyPair | undefined> {
    if (typeof indexedDB === 'undefined') return undefined;
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('scattered-keyhole-e2ee', 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('identity')) d.createObjectStore('identity');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction('identity', 'readonly');
      const store = tx.objectStore('identity');
      const record = await new Promise<unknown>((resolve, reject) => {
        const r = store.get('keypair');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      db.close();
      if (record === undefined) return undefined;
      return importKeyPairJwk(record as { publicKey: JsonWebKey; privateKey: JsonWebKey });
    } catch {
      return undefined;
    }
  }

  async #persistKeyPair(keyPair: CryptoKeyPair): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    try {
      const exported = await exportKeyPairJwk(keyPair);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('scattered-keyhole-e2ee', 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('identity')) d.createObjectStore('identity');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction('identity', 'readwrite');
      const store = tx.objectStore('identity');
      store.put(exported, 'keypair');
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch {
      // Persistence is best-effort; fall back to ephemeral keys.
    }
  }

  async #getKeyPair(): Promise<CryptoKeyPair> {
    if (this.#keyPair !== undefined) return this.#keyPair;
    if (this.#keyPairPromise === undefined) {
      this.#keyPairPromise = (async () => {
        const persisted = await this.#loadPersistedKeyPair();
        if (persisted !== undefined) {
          this.#keyPair = persisted;
          return persisted;
        }
        const generated = await generateKeyPair();
        this.#keyPair = generated;
        void this.#persistKeyPair(generated);
        return generated;
      })();
    }
    try {
      const keyPair = await this.#keyPairPromise;
      this.#keyPair = keyPair;
      return keyPair;
    } catch (error) {
      this.#keyPairPromise = undefined;
      throw error;
    }
  }

  async getPublicKey(): Promise<string> {
    const keyPair = await this.#getKeyPair();
    return exportPublicKey(keyPair.publicKey);
  }

  // Tier-6 PQ: ML-KEM-768 public key for hybrid key exchange.
  getPqPublicKey(): string {
    if (this.#pqKeyPair === undefined) {
      this.#pqKeyPair = generatePqKeyPair();
    }
    return btoa(String.fromCharCode(...this.#pqKeyPair!.publicKey));
  }

  getPqPrivateKey(): Uint8Array | undefined {
    return this.#pqKeyPair?.privateKey;
  }

  // Derive a shared key with ourselves so group messages echoed back to the
  // sender (and group self-decryption) work without a network round-trip.
  async ensureSelfKey(username: string): Promise<void> {
    if (this.#sharedKeys.has(username)) return;
    const publicKey = await this.getPublicKey();
    await this.deriveSharedSecret(username, publicKey);
  }

  async deriveSharedSecret(peerUsername: string, peerPublicKeyBase64: string): Promise<CryptoKey> {
    const keyPair = await this.#getKeyPair();
    const peerKey = await importPublicKey(peerPublicKeyBase64);
    const sharedKey = await deriveSharedKey(keyPair.privateKey, peerKey);
    this.#sharedKeys.set(peerUsername, sharedKey);
    this.#peerPublicKeys.set(peerUsername, peerPublicKeyBase64);
    return sharedKey;
  }

  async encrypt(
    peerUsername: string,
    plaintext: string,
  ): Promise<{ readonly ciphertext: string; readonly iv: string }> {
    const key = this.#sharedKeys.get(peerUsername);
    if (key === undefined) {
      throw new Error(`No shared key for ${peerUsername}`);
    }
    return e2eeEncrypt(plaintext, key);
  }

  async decrypt(peerUsername: string, ciphertext: string, iv: string): Promise<string> {
    const key = this.#sharedKeys.get(peerUsername);
    if (key === undefined) {
      throw new Error(`No shared key for ${peerUsername}`);
    }
    return e2eeDecrypt(ciphertext, iv, key);
  }

  hasSharedKey(peerUsername: string): boolean {
    return this.#sharedKeys.has(peerUsername);
  }

  // Safety number (Tier-6): a fingerprint of the two identity public keys so
  // users can verify the E2EE session out of band. Returns null until both
  // keys have been exchanged.
  async getSafetyNumber(peerUsername: string): Promise<string | null> {
    const peerKey = this.#peerPublicKeys.get(peerUsername);
    if (peerKey === undefined) return null;
    const ownKey = await this.getPublicKey();
    const combined = new TextEncoder().encode(ownKey + ':' + peerKey);
    const hash = await crypto.subtle.digest('SHA-256', combined);
    const hex = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    return hex.match(/.{1,4}/g)?.join(' ') ?? hex;
  }

  getPeerPublicKey(peerUsername: string): string | undefined {
    return this.#peerPublicKeys.get(peerUsername);
  }

  // A peer who rejoins may have generated a new keypair (page reload, logout).
  // Drop the old shared key so sends wait for the fresh key exchange instead
  // of encrypting with a key the peer can no longer decrypt.
  forgetSharedKey(peerUsername: string): void {
    this.#sharedKeys.delete(peerUsername);
    this.#peerPublicKeys.delete(peerUsername);
  }

  // Public keys arrive asynchronously after a peer joins/reconnects. Wait a
  // short while for the key instead of failing the send immediately.
  async waitForSharedKey(
    peerUsername: string,
    timeoutMs = 3000,
    intervalMs = 75,
  ): Promise<boolean> {
    if (this.hasSharedKey(peerUsername)) return true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, intervalMs);
      });
      if (this.hasSharedKey(peerUsername)) return true;
    }
    return this.hasSharedKey(peerUsername);
  }
}
