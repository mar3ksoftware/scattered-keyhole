// ── E2EE session manager ───────────────────────────────────────────────
//
// Dart port of frontend/src/lib/e2ee-session.ts. Manages one ECDH keypair
// plus a per-peer AES-GCM shared key cache.
//
// Protocol v1 (Tier-6 PQ): alongside the ECDH-only keys the session tracks
// ML-KEM-768 secrets and derives a per-peer *hybrid* key from
// `ecdhBits || mlkemSecret` (see crypto/e2ee.dart, deriveHybridKey). The
// ECDH-only key is never destroyed — it stays as the decrypt fallback for
// messages sent before the hybrid key existed or by peers without ML-KEM.

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:pointycastle/digests/sha256.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'e2ee.dart';
import 'e2ee.dart'
    as crypto
    show
        decrypt,
        deriveEcdhBits,
        encrypt,
        exportPrivateKeyHex,
        exportPublicKey,
        generateKeyPair,
        hkdfSha256,
        importKeyPairFromHex,
        importPublicKey;
import 'pq_kem.dart';

/// Manages the local ECDH keypair and per-peer shared AES keys.
class E2eeSession {
  E2eeSession({PqKem? pqKem}) : _pqKem = pqKem ?? MlkemNativeKem();

  E2eeKeyPair? _keyPair;
  Future<E2eeKeyPair>? _keyPairFuture;
  final Map<String, SharedKey> _sharedKeys = <String, SharedKey>{};
  final Map<String, String> _peerPublicKeys = <String, String>{};

  // ── Protocol v1 PQ state ──────────────────────────────────────────────
  final PqKem _pqKem;
  String? _ownUsername;
  PqKeyPair? _pqKeyPair;
  Future<PqKeyPair>? _pqKeyPairFuture;
  final Map<String, Uint8List> _peerPqPublicKeys = <String, Uint8List>{};
  final Map<String, Uint8List> _ecdhBits = <String, Uint8List>{};
  final Map<String, Uint8List> _mlkemOut = <String, Uint8List>{};
  final Map<String, Uint8List> _mlkemIn = <String, Uint8List>{};
  final Map<String, SharedKey> _hybridKeys = <String, SharedKey>{};
  final Set<String> _encapPending = <String>{};
  final Map<String, Uint8List> _pendingOutgoingCts = <String, Uint8List>{};
  final Map<String, Uint8List> _pendingIncomingCts = <String, Uint8List>{};
  final Map<String, void Function(Uint8List ct)> _mlkemCtSenders =
      <String, void Function(Uint8List ct)>{};

  /// Returns the P-256 keypair, generating it once and serializing concurrent
  /// callers so every key exchange uses the same identity.
  static const String _prefsKey = 'e2ee_identity_scalar';

  Future<E2eeKeyPair> _loadOrGenerate() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getString(_prefsKey);
      if (stored != null && stored.isNotEmpty) {
        return await crypto.importKeyPairFromHex(stored);
      }
    } catch (_) {
      // Fall through to generation.
    }
    final generated = await crypto.generateKeyPair();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefsKey, crypto.exportPrivateKeyHex(generated));
    } catch (_) {
      // Persistence is best-effort.
    }
    return generated;
  }

  Future<E2eeKeyPair> _getKeyPair() async {
    final cached = _keyPair;
    if (cached != null) return cached;

    var future = _keyPairFuture;
    if (future == null) {
      future = _loadOrGenerate();
      _keyPairFuture = future;
    }

    try {
      final keyPair = await future;
      _keyPair = keyPair;
      return keyPair;
    } catch (_) {
      // Allow a later call to retry after a generation failure.
      if (identical(_keyPairFuture, future)) {
        _keyPairFuture = null;
      }
      rethrow;
    }
  }

  /// Returns our own public key as standard base64 of the raw 65-byte point.
  Future<String> getPublicKey() async {
    final keyPair = await _getKeyPair();
    return crypto.exportPublicKey(keyPair.publicKey);
  }

  // ── Tier-6 PQ: ML-KEM-768 ─────────────────────────────────────────────

  /// Records our own username. Protocol v1 decides which side encapsulates
  /// by comparing usernames (`own < peer` ⇒ we are the initiator), so the
  /// session needs to know ours before combining.
  void setOwnUsername(String username) {
    if (_ownUsername == username) return;
    _ownUsername = username;
    // The initiator role may have been undecided when the parts first
    // arrived; re-run encapsulation/combination for every known peer.
    for (final peer in _ecdhKeys()) {
      unawaited(_ignoreErrors(_maybeEncapsulate(peer)));
      unawaited(_ignoreErrors(_tryCombine(peer)));
    }
  }

  /// Whether we are the protocol-v1 initiator for [peerUsername].
  bool isInitiator(String peerUsername) {
    final own = _ownUsername;
    return own != null && own.compareTo(peerUsername) < 0;
  }

  Iterable<String> _ecdhKeys() => List<String>.unmodifiable(_ecdhBits.keys);

  /// Our ML-KEM-768 public key as standard base64 (protocol v1 field
  /// `mlkemPublicKey`), generating the keypair lazily on first use.
  ///
  /// Ciphertexts that arrived before our keypair existed are decapsulated
  /// here (protocol v1 buffers them).
  Future<String> getPqPublicKey() async {
    final keyPair = await _getPqKeyPair();
    for (final peer in List<String>.of(_pendingIncomingCts.keys)) {
      final ct = _pendingIncomingCts.remove(peer);
      if (ct == null) continue;
      await handleMlkemCiphertext(peer, base64Encode(ct));
    }
    return base64Encode(keyPair.publicKey);
  }

  Future<PqKeyPair> _getPqKeyPair() async {
    final cached = _pqKeyPair;
    if (cached != null) return cached;

    var future = _pqKeyPairFuture;
    if (future == null) {
      future = Future<PqKeyPair>.sync(_pqKem.generateKeyPair);
      _pqKeyPairFuture = future;
    }

    try {
      final keyPair = await future;
      _pqKeyPair = keyPair;
      return keyPair;
    } catch (_) {
      if (identical(_pqKeyPairFuture, future)) {
        _pqKeyPairFuture = null;
      }
      rethrow;
    }
  }

  /// Registers the transport callback used to emit `e2ee:mlkem_ct` to
  /// [peerUsername], flushing a ciphertext that was encapsulated before the
  /// callback existed.
  void registerMlkemCtSender(
    String peerUsername,
    void Function(Uint8List ct) send,
  ) {
    _mlkemCtSenders[peerUsername] = send;
    final pending = _pendingOutgoingCts.remove(peerUsername);
    if (pending != null) send(pending);
  }

  /// Called when the peer's ML-KEM public key is received.
  ///
  /// Protocol v1: only the lower username encapsulates and emits
  /// `e2ee:mlkem_ct`; the other side just stores the key and waits for the
  /// peer's ciphertext.
  Future<void> handlePeerPqPublicKey(String peerUsername, String publicKeyBase64) async {
    _peerPqPublicKeys[peerUsername] = Uint8List.fromList(base64Decode(publicKeyBase64));
    await _maybeEncapsulate(peerUsername);
    await _tryCombine(peerUsername);
  }

  /// Called when an `e2ee:mlkem_ct` relay is received: decapsulate with our
  /// private key and combine. Buffered when our keypair does not exist yet.
  Future<void> handleMlkemCiphertext(String peerUsername, String ciphertextBase64) async {
    if (_pqKeyPair == null) {
      // Our public key has not been generated (or announced) yet, so buffer
      // the ciphertext; getPqPublicKey() decapsulates it once the keypair
      // exists (protocol v1 late-arrival handling).
      _pendingIncomingCts[peerUsername] =
          Uint8List.fromList(base64Decode(ciphertextBase64));
      return;
    }
    final ciphertext = Uint8List.fromList(base64Decode(ciphertextBase64));
    final keyPair = _pqKeyPair!;
    try {
      final secret = _pqKem.decapsulate(ciphertext, keyPair.secretKey);
      _mlkemIn[peerUsername] = secret;
      await _tryCombine(peerUsername);
    } catch (_) {
      // Invalid ciphertext (wrong key or corruption) — ignore.
    }
  }

  /// Encapsulates to the peer when protocol v1 makes us the initiator.
  ///
  /// The reservation set keeps a concurrent ECDH/PQ arrival from emitting two
  /// ciphertexts: the peer would decapsulate a different secret than the one
  /// we keep, and the hybrid keys would silently disagree.
  Future<void> _maybeEncapsulate(String peerUsername) async {
    if (!isInitiator(peerUsername)) return;
    if (_mlkemOut.containsKey(peerUsername) || _encapPending.contains(peerUsername)) return;
    final peerPqPk = _peerPqPublicKeys[peerUsername];
    if (peerPqPk == null) return;
    _encapPending.add(peerUsername);
    try {
      final result = _pqKem.encapsulate(peerPqPk);
      _mlkemOut[peerUsername] = result.sharedSecret;
      _sendMlkemCt(peerUsername, result.ciphertext);
      // ECDH bits may already be here — combine as soon as both exist.
      await _tryCombine(peerUsername);
    } finally {
      _encapPending.remove(peerUsername);
    }
  }

  void _sendMlkemCt(String peerUsername, Uint8List ciphertext) {
    final send = _mlkemCtSenders[peerUsername];
    if (send != null) {
      send(ciphertext);
      return;
    }
    _pendingOutgoingCts[peerUsername] = ciphertext;
  }

  /// Derives the hybrid key once ECDH bits and the relevant ML-KEM secret
  /// (mlkemOut when we are the initiator for this peer, mlkemIn otherwise)
  /// are both present. Re-runs whenever a part arrives, so out-of-order
  /// delivery is safe (protocol v1 rule 7).
  Future<void> _tryCombine(String peerUsername) async {
    final ecdhBits = _ecdhBits[peerUsername];
    if (ecdhBits == null) return;
    final mlkemSecret = isInitiator(peerUsername)
        ? _mlkemOut[peerUsername]
        : _mlkemIn[peerUsername];
    if (mlkemSecret == null) return;
    _hybridKeys[peerUsername] = await deriveHybridKey(
      ecdhBits: ecdhBits,
      mlkemSecret: mlkemSecret,
    );
  }

  /// Whether the hybrid (ECDH + ML-KEM) key is available for [peerUsername].
  bool hasHybridKey(String peerUsername) => _hybridKeys.containsKey(peerUsername);

  // ── ECDH key exchange ────────────────────────────────────────────────

  /// Derives a shared key with ourselves so group messages echoed back to the
  /// sender (and group self-decryption) work without a network round-trip.
  Future<void> ensureSelfKey(String username) async {
    if (_sharedKeys.containsKey(username)) return;
    final publicKey = await getPublicKey();
    await deriveSharedSecret(username, publicKey);
  }

  /// Derives and caches the AES key shared with [peerUsername].
  Future<SharedKey> deriveSharedSecret(
    String peerUsername,
    String peerPublicKeyBase64,
  ) async {
    final keyPair = await _getKeyPair();
    final peerKey = await crypto.importPublicKey(peerPublicKeyBase64);
    final bits = await crypto.deriveEcdhBits(keyPair, peerKey);
    _ecdhBits[peerUsername] = bits;
    // Same HKDF as crypto.deriveSharedKey, but over the bits we just derived
    // (kept separately: they are the first half of the PQ hybrid material).
    final sharedKey = await crypto.hkdfSha256(inputKeyMaterial: bits);
    _sharedKeys[peerUsername] = sharedKey;
    _peerPublicKeys[peerUsername] = peerPublicKeyBase64;
    // The peer's ML-KEM key may already be known: encapsulate now if we are
    // the initiator (never blocks the ECDH key from becoming usable).
    unawaited(_ignoreErrors(_maybeEncapsulate(peerUsername)));
    unawaited(_ignoreErrors(_tryCombine(peerUsername)));
    return sharedKey;
  }

  /// Encrypts [plaintext] for [peerUsername]. Throws [StateError] when no
  /// shared key is available yet.
  ///
  /// Protocol v1: uses the hybrid key once available, otherwise the
  /// ECDH-only key.
  Future<EncryptedPayload> encrypt(
    String peerUsername,
    String plaintext,
  ) async {
    final key = _hybridKeys[peerUsername] ?? _sharedKeys[peerUsername];
    if (key == null) {
      throw StateError('No shared key for $peerUsername');
    }
    return crypto.encrypt(plaintext, key);
  }

  /// Decrypts [ciphertext] from [peerUsername]. Throws [StateError] when no
  /// shared key is available yet.
  ///
  /// Protocol v1: tries the hybrid key first, then falls back to the
  /// ECDH-only key (messages sent before the hybrid key existed, or by a
  /// peer without ML-KEM). The ECDH key is never destroyed, so the fallback
  /// always has something to try.
  Future<String> decrypt(
    String peerUsername,
    String ciphertext,
    String iv,
  ) async {
    final hybrid = _hybridKeys[peerUsername];
    if (hybrid != null) {
      try {
        return await crypto.decrypt(ciphertext, iv, hybrid);
      } on E2eeDecryptionException {
        // Wrong key for this message — fall through to the ECDH-only key.
      }
    }
    final key = _sharedKeys[peerUsername];
    if (key == null) {
      throw StateError('No shared key for $peerUsername');
    }
    return crypto.decrypt(ciphertext, iv, key);
  }

  bool hasSharedKey(String peerUsername) =>
      _sharedKeys.containsKey(peerUsername);

  /// Safety number (Tier-6): fingerprint of the two identity public keys.
  Future<String?> getSafetyNumber(String peerUsername) async {
    final peerKey = _peerPublicKeys[peerUsername];
    if (peerKey == null) return null;
    final ownKey = await getPublicKey();
    final combined = utf8.encode('$ownKey:$peerKey');
    final digest = SHA256Digest().process(Uint8List.fromList(combined));
    final hex = digest.map((b) => b.toRadixString(16).padLeft(2, '0')).join().toUpperCase();
    final groups = <String>[];
    for (var i = 0; i < hex.length; i += 4) {
      groups.add(hex.substring(i, i + 4 > hex.length ? hex.length : i + 4));
    }
    return groups.join(' ');
  }

  /// Drops the cached key for [peerUsername].
  ///
  /// A peer who rejoins may have generated a new keypair (page reload, logout).
  /// Dropping the old key makes sends wait for the fresh exchange instead of
  /// encrypting with a key the peer can no longer decrypt. The PQ state for
  /// the peer goes with it so a fresh exchange re-encapsulates.
  void forgetSharedKey(String peerUsername) {
    _sharedKeys.remove(peerUsername);
    _peerPublicKeys.remove(peerUsername);
    _peerPqPublicKeys.remove(peerUsername);
    _ecdhBits.remove(peerUsername);
    _mlkemOut.remove(peerUsername);
    _mlkemIn.remove(peerUsername);
    _hybridKeys.remove(peerUsername);
    _pendingOutgoingCts.remove(peerUsername);
    _pendingIncomingCts.remove(peerUsername);
    _encapPending.remove(peerUsername);
  }

  /// Waits up to [timeoutMs] for a shared key to arrive, polling every
  /// [intervalMs].
  ///
  /// Public keys arrive asynchronously after a peer joins/reconnects, so a send
  /// should wait briefly instead of failing immediately.
  Future<bool> waitForSharedKey(
    String peerUsername, {
    int timeoutMs = 3000,
    int intervalMs = 75,
  }) async {
    if (hasSharedKey(peerUsername)) return true;

    final deadline = DateTime.now().millisecondsSinceEpoch + timeoutMs;
    while (DateTime.now().millisecondsSinceEpoch < deadline) {
      await Future<void>.delayed(Duration(milliseconds: intervalMs));
      if (hasSharedKey(peerUsername)) return true;
    }
    return hasSharedKey(peerUsername);
  }

  static Future<void> _ignoreErrors(Future<void> future) async {
    try {
      await future;
    } catch (_) {
      // Best-effort background work (encapsulation/combination).
    }
  }
}
