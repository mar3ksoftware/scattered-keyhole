import 'json_utils.dart';

/// Local view of a 1:1 call.
///
/// Mirrors the web client's `callState` union: the signaling handshake is the
/// same on both platforms, only the media stack differs.
enum CallState { idle, calling, incoming, connected }

/// Outbound `call:offer` payload. The server relays it to `to` and attaches
/// the sender identity on the way out.
class CallOfferPayload {
  const CallOfferPayload({required this.to, required this.sdp});

  factory CallOfferPayload.fromJson(Map<String, dynamic> json) {
    return CallOfferPayload(
      to: readString(json['to']),
      sdp: readString(json['sdp']),
    );
  }

  final String to;
  final String sdp;

  Map<String, dynamic> toJson() => <String, dynamic>{'to': to, 'sdp': sdp};
}

/// Outbound `call:answer` payload.
class CallAnswerPayload {
  const CallAnswerPayload({required this.to, required this.sdp});

  factory CallAnswerPayload.fromJson(Map<String, dynamic> json) {
    return CallAnswerPayload(
      to: readString(json['to']),
      sdp: readString(json['sdp']),
    );
  }

  final String to;
  final String sdp;

  Map<String, dynamic> toJson() => <String, dynamic>{'to': to, 'sdp': sdp};
}

/// Outbound `call:ice` payload.
///
/// [candidate] is the serialized ICE candidate exactly as the web client
/// sends it (`JSON.stringify` of the browser candidate), so both clients can
/// parse each other's candidates without a translation layer.
class CallIcePayload {
  const CallIcePayload({required this.to, required this.candidate});

  factory CallIcePayload.fromJson(Map<String, dynamic> json) {
    return CallIcePayload(
      to: readString(json['to']),
      candidate: readString(json['candidate']),
    );
  }

  final String to;
  final String candidate;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'to': to,
    'candidate': candidate,
  };
}

/// Outbound `call:end` / `call:reject` payload — both carry only the peer.
class CallEndPayload {
  const CallEndPayload({required this.to});

  factory CallEndPayload.fromJson(Map<String, dynamic> json) {
    return CallEndPayload(to: readString(json['to']));
  }

  final String to;

  Map<String, dynamic> toJson() => <String, dynamic>{'to': to};
}

/// Inbound `call:offer` relay.
class CallOfferRelay {
  const CallOfferRelay({
    required this.from,
    required this.fromUsername,
    required this.sdp,
  });

  factory CallOfferRelay.fromJson(Map<String, dynamic> json) {
    return CallOfferRelay(
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
      sdp: readString(json['sdp']),
    );
  }

  final String from;
  final String fromUsername;
  final String sdp;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'from': from,
    'fromUsername': fromUsername,
    'sdp': sdp,
  };
}

/// Inbound `call:answer` relay.
class CallAnswerRelay {
  const CallAnswerRelay({
    required this.from,
    required this.fromUsername,
    required this.sdp,
  });

  factory CallAnswerRelay.fromJson(Map<String, dynamic> json) {
    return CallAnswerRelay(
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
      sdp: readString(json['sdp']),
    );
  }

  final String from;
  final String fromUsername;
  final String sdp;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'from': from,
    'fromUsername': fromUsername,
    'sdp': sdp,
  };
}

/// Inbound `call:ice` relay. [candidate] stays a JSON string: the transport
/// decodes it right before handing it to the peer connection.
class CallIceRelay {
  const CallIceRelay({
    required this.from,
    required this.fromUsername,
    required this.candidate,
  });

  factory CallIceRelay.fromJson(Map<String, dynamic> json) {
    return CallIceRelay(
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
      candidate: readString(json['candidate']),
    );
  }

  final String from;
  final String fromUsername;
  final String candidate;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'from': from,
    'fromUsername': fromUsername,
    'candidate': candidate,
  };
}

/// Inbound `call:end` / `call:reject` relay.
///
/// The two events differ only in intent (hang up vs. decline); the payload is
/// the same, so one model covers both.
class CallEndRelay {
  const CallEndRelay({required this.from, required this.fromUsername});

  factory CallEndRelay.fromJson(Map<String, dynamic> json) {
    return CallEndRelay(
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
    );
  }

  final String from;
  final String fromUsername;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'from': from,
    'fromUsername': fromUsername,
  };
}
