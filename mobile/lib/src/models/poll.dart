import 'json_utils.dart';

/// A poll definition carried inside the E2EE plaintext envelope (spec B1):
/// the question plus the ordered option labels that vote indices point at.
class PollDefinition {
  const PollDefinition({required this.question, required this.options});

  /// Envelope rules: `q` 1..200 chars (raw length, no trim), `o` 2..10
  /// entries of 1..60 chars, unique by exact string match. Any failure
  /// returns null so the receiver renders the message as raw text.
  static PollDefinition? fromEnvelope(Map<String, dynamic> fields) {
    final question = fields['q'];
    if (question is! String || question.isEmpty || question.length > 200) {
      return null;
    }

    final options = fields['o'];
    if (options is! List) return null;
    if (options.length < 2 || options.length > 10) return null;

    final parsed = <String>[];
    for (final option in options) {
      if (option is! String || option.isEmpty || option.length > 60) {
        return null;
      }
      parsed.add(option);
    }
    if (parsed.toSet().length != parsed.length) return null;
    return PollDefinition(
      question: question,
      options: List<String>.unmodifiable(parsed),
    );
  }

  /// [fromEnvelope] for an already-decoded `{q, o}` value (wire models).
  static PollDefinition? tryFromJson(Object? value) {
    if (value is! Map) return null;
    return fromEnvelope(asJsonMap(value));
  }

  final String question;
  final List<String> options;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'q': question,
    'o': options,
  };
}

/// Outbound `poll:vote` payload (spec B3).
class PollVotePayload {
  const PollVotePayload({
    required this.pollId,
    required this.option,
    this.to,
    this.groupId,
  });

  final String pollId;

  /// Chosen option index, 0..9.
  final int option;
  final String? to;
  final String? groupId;

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (to != null) 'to': to,
    if (groupId != null) 'groupId': groupId,
    'pollId': pollId,
    'option': option,
  };
}

/// Outbound `poll:close` payload (spec B3).
class PollClosePayload {
  const PollClosePayload({required this.pollId, this.to, this.groupId});

  final String pollId;
  final String? to;
  final String? groupId;

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (to != null) 'to': to,
    if (groupId != null) 'groupId': groupId,
    'pollId': pollId,
  };
}

/// Inbound `poll:voted` relay — the send payload plus the voter (`u`).
class PollVotedPayload {
  const PollVotedPayload({
    required this.pollId,
    required this.option,
    required this.u,
    this.to,
    this.groupId,
  });

  factory PollVotedPayload.fromJson(Map<String, dynamic> json) {
    return PollVotedPayload(
      pollId: readString(json['pollId']),
      // Strict integer read: a fractional option can never be in range.
      option: json['option'] is int ? json['option'] as int : -1,
      u: readString(json['u']),
      to: json['to'] is String ? json['to'] as String : null,
      groupId: json['groupId'] is String ? json['groupId'] as String : null,
    );
  }

  final String pollId;
  final int option;
  final String u;
  final String? to;
  final String? groupId;
}

/// Inbound `poll:closed` relay — the send payload plus the closer (`u`).
class PollClosedPayload {
  const PollClosedPayload({
    required this.pollId,
    required this.u,
    this.to,
    this.groupId,
  });

  factory PollClosedPayload.fromJson(Map<String, dynamic> json) {
    return PollClosedPayload(
      pollId: readString(json['pollId']),
      u: readString(json['u']),
      to: json['to'] is String ? json['to'] as String : null,
      groupId: json['groupId'] is String ? json['groupId'] as String : null,
    );
  }

  final String pollId;
  final String u;
  final String? to;
  final String? groupId;
}
