// ── Post-quantum KEM abstraction (Tier-6) ──────────────────────────────
//
// Protocol v1 uses FIPS 203 ML-KEM-768, wire-compatible with the web
// client's `mlkem` npm package. The production implementation wraps the
// `mlkem_native` FFI plugin; the session also accepts an injectable [PqKem]
// so the combine/fallback logic can be unit-tested without the native
// library.

import 'dart:typed_data';

import 'package:mlkem_native/mlkem768.dart';

/// An ML-KEM key pair (public + secret key).
class PqKeyPair {
  const PqKeyPair({required this.publicKey, required this.secretKey});

  final Uint8List publicKey;
  final Uint8List secretKey;
}

/// The result of encapsulating to a peer's public key.
class PqEncapsulation {
  const PqEncapsulation({required this.ciphertext, required this.sharedSecret});

  final Uint8List ciphertext;
  final Uint8List sharedSecret;
}

/// The KEM surface the E2EE session needs (protocol v1).
abstract interface class PqKem {
  PqKeyPair generateKeyPair();
  PqEncapsulation encapsulate(Uint8List publicKey);
  Uint8List decapsulate(Uint8List ciphertext, Uint8List secretKey);
}

/// Production KEM: ML-KEM-768 from `mlkem_native` (native FFI, FIPS 203).
class MlkemNativeKem implements PqKem {
  final MLKEM768 _kem = MLKEM768();

  @override
  PqKeyPair generateKeyPair() {
    final keyPair = _kem.generateKeyPair();
    return PqKeyPair(publicKey: keyPair.publicKey, secretKey: keyPair.secretKey);
  }

  @override
  PqEncapsulation encapsulate(Uint8List publicKey) {
    final result = _kem.encapsulate(publicKey);
    return PqEncapsulation(
      ciphertext: result.ciphertext,
      sharedSecret: result.sharedSecret,
    );
  }

  @override
  Uint8List decapsulate(Uint8List ciphertext, Uint8List secretKey) =>
      _kem.decapsulate(ciphertext, secretKey);
}
