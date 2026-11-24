// Smoke test for the `mlkem_native` FFI package under `flutter test`.
//
// The package ships native assets (hooks + C build), so this guards the
// build/load path itself: if the native library fails to compile or load,
// this test fails loudly instead of the PQ path silently degrading.

import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mlkem_native/mlkem768.dart';

void main() {
  test('ML-KEM-768 keygen / encapsulate / decapsulate round-trips', () {
    final kem = MLKEM768();

    final keyPair = kem.generateKeyPair();
    expect(keyPair.publicKey.length, 1184);
    expect(keyPair.secretKey.length, 2400);

    final result = kem.encapsulate(keyPair.publicKey);
    expect(result.ciphertext.length, 1088);
    expect(result.sharedSecret.length, 32);

    final shared = kem.decapsulate(result.ciphertext, keyPair.secretKey);
    expect(shared, isA<Uint8List>());
    expect(shared, result.sharedSecret);

    // A second encapsulation is a fresh KEM transaction: a different
    // ciphertext and a different shared secret, decapsulating correctly.
    final second = kem.encapsulate(keyPair.publicKey);
    expect(second.ciphertext, isNot(result.ciphertext));
    expect(second.sharedSecret, isNot(result.sharedSecret));
    expect(kem.decapsulate(second.ciphertext, keyPair.secretKey), second.sharedSecret);
  });
}
