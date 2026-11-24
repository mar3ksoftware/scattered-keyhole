import 'json_utils.dart';

/// Outbound `e2ee:public_key` payload.
class E2eePublicKeyPayload {
  const E2eePublicKeyPayload({
    required this.to,
    required this.publicKey,
    this.mlkemPublicKey,
  });

  factory E2eePublicKeyPayload.fromJson(Map<String, dynamic> json) {
    return E2eePublicKeyPayload(
      to: readString(json['to']),
      publicKey: readString(json['publicKey']),
      mlkemPublicKey: readNullableString(json['mlkemPublicKey']),
    );
  }

  final String to;
  final String publicKey;

  /// Protocol v1 ML-KEM-768 public key (standard base64). Null for peers
  /// without PQ support.
  final String? mlkemPublicKey;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'to': to,
    'publicKey': publicKey,
    if (mlkemPublicKey != null) 'mlkemPublicKey': mlkemPublicKey,
  };
}

/// Inbound `e2ee:public_key` relay. The server attaches the sender identity.
class E2eePublicKeyRelay {
  const E2eePublicKeyRelay({
    required this.from,
    required this.fromUsername,
    required this.publicKey,
    this.mlkemPublicKey,
  });

  factory E2eePublicKeyRelay.fromJson(Map<String, dynamic> json) {
    return E2eePublicKeyRelay(
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
      publicKey: readString(json['publicKey']),
      mlkemPublicKey: readNullableString(json['mlkemPublicKey']),
    );
  }

  final String from;
  final String fromUsername;
  final String publicKey;

  /// Protocol v1 ML-KEM-768 public key (standard base64), when the peer sent
  /// one.
  final String? mlkemPublicKey;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'from': from,
    'fromUsername': fromUsername,
    'publicKey': publicKey,
    if (mlkemPublicKey != null) 'mlkemPublicKey': mlkemPublicKey,
  };
}

/// Outbound `e2ee:mlkem_ct` payload (protocol v1).
class E2eeMlkemCtPayload {
  const E2eeMlkemCtPayload({required this.to, required this.ciphertext});

  factory E2eeMlkemCtPayload.fromJson(Map<String, dynamic> json) {
    return E2eeMlkemCtPayload(
      to: readString(json['to']),
      ciphertext: readString(json['ciphertext']),
    );
  }

  final String to;

  /// ML-KEM-768 ciphertext, standard base64.
  final String ciphertext;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'to': to,
    'ciphertext': ciphertext,
  };
}

/// Inbound `e2ee:mlkem_ct` relay (protocol v1). The server attaches the sender.
class E2eeMlkemCtRelay {
  const E2eeMlkemCtRelay({
    required this.from,
    required this.fromUsername,
    required this.ciphertext,
  });

  factory E2eeMlkemCtRelay.fromJson(Map<String, dynamic> json) {
    return E2eeMlkemCtRelay(
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
      ciphertext: readString(json['ciphertext']),
    );
  }

  final String from;
  final String fromUsername;

  /// ML-KEM-768 ciphertext, standard base64.
  final String ciphertext;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'from': from,
    'fromUsername': fromUsername,
    'ciphertext': ciphertext,
  };
}
