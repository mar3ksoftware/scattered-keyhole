import 'dart:convert';

import '../models/json_utils.dart';
import '../models/media.dart';
import '../models/poll.dart';

/// Maximum length of a reply excerpt shown on a bubble.
const int kReplyExcerptMax = 140;

/// A parsed payload envelope. Mirrors the frontend's `parseEnvelope`.
class ParsedEnvelope {
  final String? text;
  final MediaDescriptor? media;
  final PollDefinition? poll;
  final String? raw;
  final Map<String, dynamic>? reply;

  /// Disappearance deadline (spec C) parsed from the top-level `exp` field;
  /// null when absent or malformed (drop-never-reject).
  final int? expiresAt;

  const ParsedEnvelope({
    this.text,
    this.media,
    this.poll,
    this.raw,
    this.reply,
    this.expiresAt,
  });

  bool get isText => text != null;
  bool get isMedia => media != null;
  bool get isPoll => poll != null;
  bool get isRaw => raw != null;
}

Map<String, dynamic>? _parseReplyRef(dynamic value) {
  if (value is! Map) return null;
  final id = value['id'];
  final u = value['u'];
  final e = value['e'];
  if (id is String && u is String && e is String) {
    return {'id': id, 'u': u, 'e': e};
  }
  return null;
}

/// Upper bound for a sane `exp`: doubles beyond `2^53` are absurd timestamps
/// and are dropped like any other malformed value (spec C).
const int _kMaxExpDouble = 9007199254740991; // 2^53 - 1

/// Parses the envelope's `exp` field (spec C): a finite number > 0 rides
/// along as the expiry, anything else (string, NaN, <= 0, absurd) drops the
/// field only so the message still renders and simply never expires.
int? _parseExpiresAt(Map<Object?, Object?> envelope) {
  final raw = envelope['exp'];
  if (raw is int) return raw > 0 ? raw : null;
  if (raw is double) {
    if (!raw.isFinite || raw <= 0 || raw > _kMaxExpDouble) return null;
    return raw.toInt();
  }
  return null;
}

/// Parses a decrypted payload exactly like the frontend's `parseEnvelope`:
/// JSON parse failure → raw; `t === 'media'` → descriptor (malformed → raw);
/// `t === 'text'` → text plus optional reply (`b` must be a string, else raw);
/// `t === 'poll'` → definition appended after text (malformed → raw);
/// any other `t` → raw.
ParsedEnvelope parseEnvelope(String decrypted) {
  Object? parsed;
  try {
    parsed = jsonDecode(decrypted);
  } on FormatException {
    return ParsedEnvelope(raw: decrypted);
  }
  if (parsed is! Map) return ParsedEnvelope(raw: decrypted);

  final envelope = parsed;
  final expiresAt = _parseExpiresAt(envelope);
  final t = envelope['t'];

  if (t == 'media') {
    final descriptor = MediaDescriptor.tryParse(decrypted);
    return descriptor != null
        ? ParsedEnvelope(media: descriptor, expiresAt: expiresAt)
        : ParsedEnvelope(raw: decrypted, expiresAt: expiresAt);
  }

  if (t == 'text') {
    final b = envelope['b'];
    if (b is! String) return ParsedEnvelope(raw: decrypted, expiresAt: expiresAt);
    return ParsedEnvelope(
      text: b,
      reply: _parseReplyRef(envelope['r']),
      expiresAt: expiresAt,
    );
  }

  if (t == 'poll') {
    final poll = PollDefinition.fromEnvelope(asJsonMap(envelope));
    if (poll == null) return ParsedEnvelope(raw: decrypted, expiresAt: expiresAt);
    return ParsedEnvelope(
      poll: poll,
      reply: _parseReplyRef(envelope['r']),
      expiresAt: expiresAt,
    );
  }

  return ParsedEnvelope(raw: decrypted, expiresAt: expiresAt);
}

/// Wraps a text send in the canonical envelope `{t:'text', b, r?, exp?}`.
/// [exp] is the disappearance deadline in epoch ms; omit it (or pass null)
/// for a timer-off send (spec C).
String wrapTextEnvelope(String body, [Map<String, dynamic>? reply, int? exp]) {
  final envelope = <String, dynamic>{'t': 'text', 'b': body};
  if (reply != null) envelope['r'] = reply;
  if (exp != null) envelope['exp'] = exp;
  return jsonEncode(envelope);
}

/// Wraps a poll send in the canonical envelope `{t:'poll', q, o, exp?}`
/// (spec B1). Returns null when the definition fails validation (same rules
/// as receive).
String? wrapPollEnvelope(String question, List<String> options, [int? exp]) {
  final poll = PollDefinition.fromEnvelope({'q': question, 'o': options});
  if (poll == null) return null;
  return jsonEncode({
    't': 'poll',
    ...poll.toJson(),
    'exp': ?exp,
  });
}

/// The `exp` stamp for a send under a timer of [seconds] (spec C): now +
/// seconds in ms, or null when the timer is off so no field is written.
int? expForTimer(int seconds, int nowMs) =>
    seconds > 0 ? nowMs + seconds * 1000 : null;

/// Builds the wire reply ref `{id, u, e}` (spec C4).
Map<String, dynamic> buildReplyRef({
  required String id,
  required String username,
  required String excerpt,
}) {
  return {'id': id, 'u': username, 'e': excerpt};
}

/// Excerpt of a reply target: first [kReplyExcerptMax] chars of [text].
String excerptOf(String text) {
  if (text.length <= kReplyExcerptMax) return text;
  return text.substring(0, kReplyExcerptMax);
}

/// Reply excerpt for a message body: media targets use the file name or
/// `"Attachment"`, poll targets use the question, text targets use the body
/// (≤140 chars).
String replyExcerptFor(String body, {String? mediaName, PollDefinition? poll}) {
  if (mediaName != null) {
    return excerptOf(mediaName.isEmpty ? 'Attachment' : mediaName);
  }
  if (poll != null) return excerptOf(poll.question);
  return excerptOf(body);
}
