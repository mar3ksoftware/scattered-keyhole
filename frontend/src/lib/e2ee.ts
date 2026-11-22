// ── E2EE crypto primitives (Web Crypto API) ────────────────────────────
// Client-side only — uses globalThis.crypto. Works in browsers.

const HKDF_INFO = new TextEncoder().encode('scattered-keyhole-e2ee-v1');
const EMPTY_SALT = new Uint8Array(0);

// ── Base64 helpers (manual, JSON-safe transport) ───────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ── Key pair generation ────────────────────────────────────────────────

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
}

// ── Public key export/import ───────────────────────────────────────────

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return arrayBufferToBase64(raw);
}

// ── Durable identity keys (Tier-6) ────────────────────────────────────
// Export/import the whole keypair as JWK so it can be persisted (IndexedDB)
// and reloaded across sessions instead of being regenerated every page load.

export type ExportedKeyPair = {
  readonly publicKey: JsonWebKey;
  readonly privateKey: JsonWebKey;
};

export async function exportKeyPairJwk(keyPair: CryptoKeyPair): Promise<ExportedKeyPair> {
  const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  return { publicKey, privateKey };
}

export async function importKeyPairJwk(exported: ExportedKeyPair): Promise<CryptoKeyPair> {
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    exported.publicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    exported.privateKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  return { publicKey, privateKey };
}

export async function importPublicKey(base64key: string): Promise<CryptoKey> {
  const raw = base64ToArrayBuffer(base64key);
  return crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}

// ── Shared key derivation (ECDH → HKDF → AES-GCM) ──────────────────────

export async function deriveEcdhBits(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey,
): Promise<ArrayBuffer> {
  return crypto.subtle.deriveBits({ name: 'ECDH', public: peerPublicKey }, privateKey, 256);
}

export async function deriveSharedKey(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey,
): Promise<CryptoKey> {
  const sharedSecret = await deriveEcdhBits(privateKey, peerPublicKey);

  const hkdfKey = await crypto.subtle.importKey('raw', sharedSecret, { name: 'HKDF' }, false, [
    'deriveBits',
  ]);

  const keyMaterial = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: EMPTY_SALT,
      info: HKDF_INFO,
    },
    hkdfKey,
    256,
  );

  return crypto.subtle.importKey('raw', keyMaterial, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

// ── Encryption / decryption ────────────────────────────────────────────

export async function encrypt(
  plaintext: string,
  sharedKey: CryptoKey,
): Promise<{ readonly ciphertext: string; readonly iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertextBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, encoded);
  return {
    ciphertext: arrayBufferToBase64(ciphertextBuffer),
    iv: arrayBufferToBase64(iv.buffer),
  };
}

export async function decrypt(
  ciphertext: string,
  iv: string,
  sharedKey: CryptoKey,
): Promise<string> {
  const ciphertextBuffer = base64ToArrayBuffer(ciphertext);
  const ivBuffer = new Uint8Array(base64ToArrayBuffer(iv));
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    sharedKey,
    ciphertextBuffer,
  );
  return new TextDecoder().decode(plaintextBuffer);
}

// ── Post-quantum (Tier-6): ML-KEM-768 hybrid ──────────────────────────
import { createMlKem768, type MlKemInterface } from 'mlkem';

let mlkemPromise: Promise<MlKemInterface> | undefined;

async function getMlkem() {
  if (mlkemPromise === undefined) mlkemPromise = createMlKem768();
  return mlkemPromise;
}

export async function generatePqKeyPair(): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}> {
  const mlkem = await getMlkem();
  const [pk, sk] = mlkem.generateKeyPair();
  return { publicKey: pk, privateKey: sk };
}

export async function pqEncapsulate(
  publicKey: Uint8Array,
): Promise<{ ciphertext: Uint8Array; sharedSecret: Uint8Array }> {
  const mlkem = await getMlkem();
  const [ct, ss] = mlkem.encap(publicKey);
  return { ciphertext: ct, sharedSecret: ss };
}

export async function pqDecapsulate(
  privateKey: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const mlkem = await getMlkem();
  return mlkem.decap(ciphertext, privateKey);
}
