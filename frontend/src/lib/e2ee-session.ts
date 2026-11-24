// ── E2EE session manager ───────────────────────────────────────────────
// Manages ECDH keypair + per-peer AES-GCM shared keys.
// Adapted from backend/src/e2ee-session.ts for browser use.

import {
  deriveEcdhBits,
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
  #peerPqPublicKeys: Map<string, Uint8Array>;
  #ecdhBits: Map<string, Uint8Array>;
  #mlkemOut: Map<string, Uint8Array>;
  #mlkemIn: Map<string, Uint8Array>;
  #mlkemCtSenders: Map<string, (ct: Uint8Array) => void>;
  // Protocol v1: the hybrid key lives beside the ECDH-only key. The ECDH key
  // is never replaced — it stays available as the decrypt fallback for
  // messages sent by peers that have not completed the PQ exchange yet.
  #hybridKeys: Map<string, CryptoKey>;
  #encapPending: Set<string>;
  #pendingCts: Map<string, Uint8Array>;
  #pendingMlkemCts: Map<string, string>;
  #ownUsername: string | undefined;

  constructor() {
    this.#keyPair = undefined;
    this.#keyPairPromise = undefined;
    this.#sharedKeys = new Map();
    this.#peerPublicKeys = new Map();
    this.#pqKeyPair = undefined;
    this.#peerPqPublicKeys = new Map();
    this.#ecdhBits = new Map();
    this.#mlkemOut = new Map();
    this.#mlkemIn = new Map();
    this.#mlkemCtSenders = new Map();
    this.#hybridKeys = new Map();
    this.#encapPending = new Set();
    this.#pendingCts = new Map();
    this.#pendingMlkemCts = new Map();
    this.#ownUsername = undefined;
  }

  // Protocol v1: our own username decides who encapsulates. Plain string
  // comparison on both clients guarantees exactly one initiator per pair.
  setOwnUsername(username: string): void {
    if (this.#ownUsername === username) return;
    this.#ownUsername = username;
    // The initiator role may have been undecided when the parts first arrived;
    // re-run encapsulation/combination for every peer we already know.
    for (const peerUsername of this.#ecdhBits.keys()) {
      void this.#maybeEncapsulate(peerUsername).catch(() => {});
      void this.#tryCombine(peerUsername);
    }
  }

  #isInitiator(peerUsername: string): boolean {
    const own = this.#ownUsername;
    return own !== undefined && own < peerUsername;
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
  async getPqPublicKey(): Promise<string> {
    const pair = this.#pqKeyPair ?? (await generatePqKeyPair());
    this.#pqKeyPair = pair;
    const publicKey = btoa(String.fromCharCode(...pair.publicKey));
    // A peer may have sent their ciphertext before our keypair existed
    // (protocol v1 buffers it). Decapsulate now that we can.
    for (const [peerUsername, ciphertext] of this.#pendingMlkemCts) {
      this.#pendingMlkemCts.delete(peerUsername);
      await this.handleMlkemCiphertext(peerUsername, ciphertext);
    }
    return publicKey;
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
    const ecdhBits = await deriveEcdhBits(keyPair.privateKey, peerKey);
    this.#ecdhBits.set(peerUsername, new Uint8Array(ecdhBits));
    const sharedKey = await deriveSharedKey(keyPair.privateKey, peerKey);
    this.#sharedKeys.set(peerUsername, sharedKey);
    this.#peerPublicKeys.set(peerUsername, peerPublicKeyBase64);
    // Encapsulate only when protocol v1 makes us the initiator for this peer
    // (or skip — handlePeerPqPublicKey does it when the PQ key arrives later).
    void this.#maybeEncapsulate(peerUsername).catch(() => {});
    void this.#tryCombine(peerUsername);
    return sharedKey;
  }

  // Protocol v1: only the side with `ownUsername < peerUsername` encapsulates.
  // The reservation set keeps a concurrent ECDH/PQ arrival from sending two
  // ciphertexts (the peer would decapsulate a different secret than the one we
  // keep, silently breaking the hybrid key).
  async #maybeEncapsulate(peerUsername: string): Promise<void> {
    if (!this.#isInitiator(peerUsername)) return;
    if (this.#mlkemOut.has(peerUsername) || this.#encapPending.has(peerUsername)) return;
    const peerPqPk = this.#peerPqPublicKeys.get(peerUsername);
    if (peerPqPk === undefined) return;
    this.#encapPending.add(peerUsername);
    try {
      const { ciphertext, sharedSecret } = await pqEncapsulate(peerPqPk);
      this.#mlkemOut.set(peerUsername, sharedSecret);
      this.#sendMlkemCt(peerUsername, ciphertext);
      // ECDH bits may already be here — combine as soon as both parts exist.
      void this.#tryCombine(peerUsername);
    } finally {
      this.#encapPending.delete(peerUsername);
    }
  }

  // Send the ciphertext, buffering it when the transport callback has not
  // been registered yet (the ct handler may run before the sender wiring).
  #sendMlkemCt(peerUsername: string, ciphertext: Uint8Array): void {
    const cb = this.#mlkemCtSenders.get(peerUsername);
    if (cb !== undefined) {
      cb(ciphertext);
      return;
    }
    this.#pendingCts.set(peerUsername, ciphertext);
  }

  async encrypt(
    peerUsername: string,
    plaintext: string,
  ): Promise<{ readonly ciphertext: string; readonly iv: string }> {
    // Protocol v1: prefer the hybrid key once both sides have combined; the
    // ECDH-only key remains the fallback for peers still on the old path.
    const key = this.#hybridKeys.get(peerUsername) ?? this.#sharedKeys.get(peerUsername);
    if (key === undefined) {
      throw new Error(`No shared key for ${peerUsername}`);
    }
    return e2eeEncrypt(plaintext, key);
  }

  async decrypt(peerUsername: string, ciphertext: string, iv: string): Promise<string> {
    // Messages may have been encrypted before the hybrid key existed (or by
    // an old client without ML-KEM), so try the hybrid key first and fall
    // back to the ECDH-only key on authentication failure.
    const hybrid = this.#hybridKeys.get(peerUsername);
    if (hybrid !== undefined) {
      try {
        return await e2eeDecrypt(ciphertext, iv, hybrid);
      } catch {
        // Wrong key for this message — fall through to the ECDH-only key.
      }
    }
    const key = this.#sharedKeys.get(peerUsername);
    if (key === undefined) {
      throw new Error(`No shared key for ${peerUsername}`);
    }
    return e2eeDecrypt(ciphertext, iv, key);
  }

  hasSharedKey(peerUsername: string): boolean {
    return this.#sharedKeys.has(peerUsername);
  }

  // Whether the hybrid (ECDH + ML-KEM) key is available for a peer.
  hasHybridKey(peerUsername: string): boolean {
    return this.#hybridKeys.has(peerUsername);
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

  // Register a callback for sending ML-KEM ciphertext to a peer. Any
  // ciphertext that was encapsulated before this wiring existed is flushed
  // now so it is never silently dropped.
  registerMlkemCtSender(peerUsername: string, cb: (ct: Uint8Array) => void): void {
    this.#mlkemCtSenders.set(peerUsername, cb);
    const pending = this.#pendingCts.get(peerUsername);
    if (pending !== undefined) {
      this.#pendingCts.delete(peerUsername);
      cb(pending);
    }
  }

  // Called when peer's ML-KEM public key is received. Protocol v1: only the
  // lower username encapsulates; the other side just stores the key and waits
  // for the peer's ciphertext.
  async handlePeerPqPublicKey(peerUsername: string, peerPqPkBase64: string): Promise<void> {
    const peerPqPk = Uint8Array.from(atob(peerPqPkBase64), (c) => c.charCodeAt(0));
    this.#peerPqPublicKeys.set(peerUsername, peerPqPk);
    await this.#maybeEncapsulate(peerUsername);
    await this.#tryCombine(peerUsername);
  }

  // Called when ML-KEM ciphertext is received from peer. Decapsulate and combine.
  async handleMlkemCiphertext(peerUsername: string, ciphertextBase64: string): Promise<void> {
    const sk = this.getPqPrivateKey();
    if (sk === undefined) {
      // Our keypair is generated lazily with our own public key; if the peer
      // beat us to it, buffer the ciphertext and decapsulate once we can.
      this.#pendingMlkemCts.set(peerUsername, ciphertextBase64);
      return;
    }
    const ct = Uint8Array.from(atob(ciphertextBase64), (c) => c.charCodeAt(0));
    try {
      const ss = await pqDecapsulate(sk, ct);
      this.#mlkemIn.set(peerUsername, ss);
      await this.#tryCombine(peerUsername);
    } catch {}
  }

  async #tryCombine(peerUsername: string): Promise<void> {
    const ecdhBits = this.#ecdhBits.get(peerUsername);
    if (ecdhBits === undefined) return;
    // Protocol v1: the initiator combines with mlkemOut, the responder with
    // mlkemIn — those are the two halves of the same KEM transaction, so both
    // sides derive the same secret. (The old `mlkemIn ?? mlkemOut` pick let
    // each side choose a different secret when both had encapsulated.)
    const mlkemSs = this.#isInitiator(peerUsername)
      ? this.#mlkemOut.get(peerUsername)
      : this.#mlkemIn.get(peerUsername);
    if (mlkemSs === undefined) return;
    // HKDF(ecdh_bits || mlkem_ss) -> AES-256 key
    const combined = new Uint8Array(ecdhBits.length + mlkemSs.length);
    combined.set(ecdhBits, 0);
    combined.set(mlkemSs, ecdhBits.length);
    const keyMaterial = await crypto.subtle.importKey('raw', combined, { name: 'HKDF' }, false, [
      'deriveBits',
    ]);
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0),
        info: new TextEncoder().encode('scattered-keyhole-pq-hybrid-v1'),
      },
      keyMaterial,
      256,
    );
    const aesKey = await crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
    // The hybrid key is stored beside the ECDH-only key, never in place of it.
    this.#hybridKeys.set(peerUsername, aesKey);
  }

  forgetSharedKey(peerUsername: string): void {
    this.#sharedKeys.delete(peerUsername);
    this.#peerPublicKeys.delete(peerUsername);
    this.#peerPqPublicKeys.delete(peerUsername);
    this.#ecdhBits.delete(peerUsername);
    this.#mlkemOut.delete(peerUsername);
    this.#mlkemIn.delete(peerUsername);
    this.#hybridKeys.delete(peerUsername);
    this.#pendingCts.delete(peerUsername);
    this.#pendingMlkemCts.delete(peerUsername);
    this.#encapPending.delete(peerUsername);
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
