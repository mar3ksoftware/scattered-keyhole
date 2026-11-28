import 'json_utils.dart';

/// Local phase of a group call.
///
/// `joining` covers the window between emitting `group_call:join` (or
/// `group_call:sfu_token`) and the server confirming with a roster or
/// credentials; `active` means media negotiation may proceed.
enum GroupCallState { idle, joining, active }

/// Wire values for a room's call topology.
///
/// Kept as string constants (rather than an enum) because the value travels
/// verbatim in `group:create`, `group:updated` and `group:topology`.
abstract final class CallTopology {
  static const String mesh = 'mesh';
  static const String sfu = 'sfu';

  /// Normalises a wire value, defaulting to mesh when absent/unknown.
  static String normalize(Object? value) =>
      value == sfu ? sfu : mesh;
}

/// Outbound `group:topology` — admin-only topology switch.
class GroupTopologyPayload {
  const GroupTopologyPayload({required this.groupId, required this.topology});

  factory GroupTopologyPayload.fromJson(Map<String, dynamic> json) {
    return GroupTopologyPayload(
      groupId: readString(json['groupId']),
      topology: CallTopology.normalize(json['topology']),
    );
  }

  final String groupId;
  final String topology;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    'topology': topology,
  };

  @override
  bool operator ==(Object other) {
    return other is GroupTopologyPayload &&
        other.groupId == groupId &&
        other.topology == topology;
  }

  @override
  int get hashCode => Object.hash(groupId, topology);
}

/// Outbound `group_call:join` (mesh only).
class GroupCallJoinPayload {
  const GroupCallJoinPayload({required this.groupId});

  factory GroupCallJoinPayload.fromJson(Map<String, dynamic> json) {
    return GroupCallJoinPayload(groupId: readString(json['groupId']));
  }

  final String groupId;

  Map<String, dynamic> toJson() => <String, dynamic>{'groupId': groupId};

  @override
  bool operator ==(Object other) =>
      other is GroupCallJoinPayload && other.groupId == groupId;

  @override
  int get hashCode => groupId.hashCode;
}

/// Outbound `group_call:leave`.
class GroupCallLeavePayload {
  const GroupCallLeavePayload({required this.groupId});

  factory GroupCallLeavePayload.fromJson(Map<String, dynamic> json) {
    return GroupCallLeavePayload(groupId: readString(json['groupId']));
  }

  final String groupId;

  Map<String, dynamic> toJson() => <String, dynamic>{'groupId': groupId};

  @override
  bool operator ==(Object other) =>
      other is GroupCallLeavePayload && other.groupId == groupId;

  @override
  int get hashCode => groupId.hashCode;
}

/// Outbound `group_call:sfu_token` — asks the server for LiveKit credentials.
class GroupCallSfuTokenPayload {
  const GroupCallSfuTokenPayload({required this.groupId});

  factory GroupCallSfuTokenPayload.fromJson(Map<String, dynamic> json) {
    return GroupCallSfuTokenPayload(groupId: readString(json['groupId']));
  }

  final String groupId;

  Map<String, dynamic> toJson() => <String, dynamic>{'groupId': groupId};

  @override
  bool operator ==(Object other) =>
      other is GroupCallSfuTokenPayload && other.groupId == groupId;

  @override
  int get hashCode => groupId.hashCode;
}

/// Outbound `group_call:offer`.
///
/// The server resolves [to] with `getUserByUsername`, so it must carry the
/// peer's username (not the opaque userId used on the inbound relays).
class GroupCallOfferPayload {
  const GroupCallOfferPayload({
    required this.groupId,
    required this.to,
    required this.sdp,
  });

  factory GroupCallOfferPayload.fromJson(Map<String, dynamic> json) {
    return GroupCallOfferPayload(
      groupId: readString(json['groupId']),
      to: readString(json['to']),
      sdp: readString(json['sdp']),
    );
  }

  final String groupId;
  final String to;
  final String sdp;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    'to': to,
    'sdp': sdp,
  };

  @override
  bool operator ==(Object other) {
    return other is GroupCallOfferPayload &&
        other.groupId == groupId &&
        other.to == to &&
        other.sdp == sdp;
  }

  @override
  int get hashCode => Object.hash(groupId, to, sdp);
}

/// Outbound `group_call:answer`.
class GroupCallAnswerPayload {
  const GroupCallAnswerPayload({
    required this.groupId,
    required this.to,
    required this.sdp,
  });

  factory GroupCallAnswerPayload.fromJson(Map<String, dynamic> json) {
    return GroupCallAnswerPayload(
      groupId: readString(json['groupId']),
      to: readString(json['to']),
      sdp: readString(json['sdp']),
    );
  }

  final String groupId;
  final String to;
  final String sdp;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    'to': to,
    'sdp': sdp,
  };

  @override
  bool operator ==(Object other) {
    return other is GroupCallAnswerPayload &&
        other.groupId == groupId &&
        other.to == to &&
        other.sdp == sdp;
  }

  @override
  int get hashCode => Object.hash(groupId, to, sdp);
}

/// Outbound `group_call:ice`. [candidate] is a serialized JSON string, the
/// same shape the 1:1 `call:ice` path uses.
class GroupCallIcePayload {
  const GroupCallIcePayload({
    required this.groupId,
    required this.to,
    required this.candidate,
  });

  factory GroupCallIcePayload.fromJson(Map<String, dynamic> json) {
    return GroupCallIcePayload(
      groupId: readString(json['groupId']),
      to: readString(json['to']),
      candidate: readString(json['candidate']),
    );
  }

  final String groupId;
  final String to;
  final String candidate;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    'to': to,
    'candidate': candidate,
  };

  @override
  bool operator ==(Object other) {
    return other is GroupCallIcePayload &&
        other.groupId == groupId &&
        other.to == to &&
        other.candidate == candidate;
  }

  @override
  int get hashCode => Object.hash(groupId, to, candidate);
}

/// One entry of a `group_call:roster` snapshot.
class GroupCallPeer {
  const GroupCallPeer({required this.userId, required this.username});

  factory GroupCallPeer.fromJson(Map<String, dynamic> json) {
    return GroupCallPeer(
      userId: readString(json['userId']),
      username: readString(json['username']),
    );
  }

  final String userId;
  final String username;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'userId': userId,
    'username': username,
  };

  @override
  bool operator ==(Object other) {
    return other is GroupCallPeer &&
        other.userId == userId &&
        other.username == username;
  }

  @override
  int get hashCode => Object.hash(userId, username);
}

/// Inbound `group_call:roster` — sent to a joiner with the peers already in
/// the call. The joiner answers their offers and never offers first.
class GroupCallRosterPayload {
  const GroupCallRosterPayload({required this.groupId, required this.peers});

  factory GroupCallRosterPayload.fromJson(Map<String, dynamic> json) {
    return GroupCallRosterPayload(
      groupId: readString(json['groupId']),
      peers: readList(
        json['peers'],
      ).map((entry) => GroupCallPeer.fromJson(asJsonMap(entry))).toList(),
    );
  }

  final String groupId;
  final List<GroupCallPeer> peers;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    'peers': peers.map((peer) => peer.toJson()).toList(),
  };
}

/// Inbound `group_call:joined` — a new participant entered the call.
class GroupCallJoinedPayload {
  const GroupCallJoinedPayload({
    required this.groupId,
    required this.from,
    required this.fromUsername,
  });

  factory GroupCallJoinedPayload.fromJson(Map<String, dynamic> json) {
    return GroupCallJoinedPayload(
      groupId: readString(json['groupId']),
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
    );
  }

  final String groupId;
  final String from;
  final String fromUsername;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    'from': from,
    'fromUsername': fromUsername,
  };
}

/// Inbound `group_call:left` — a participant (possibly us) left the call.
class GroupCallLeftPayload {
  const GroupCallLeftPayload({
    required this.groupId,
    required this.from,
    required this.fromUsername,
  });

  factory GroupCallLeftPayload.fromJson(Map<String, dynamic> json) {
    return GroupCallLeftPayload(
      groupId: readString(json['groupId']),
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
    );
  }

  final String groupId;
  final String from;
  final String fromUsername;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    'from': from,
    'fromUsername': fromUsername,
  };
}

/// Inbound `group_call:offer` relay.
class GroupCallOfferRelay {
  const GroupCallOfferRelay({
    required this.groupId,
    required this.from,
    required this.fromUsername,
    required this.sdp,
  });

  factory GroupCallOfferRelay.fromJson(Map<String, dynamic> json) {
    return GroupCallOfferRelay(
      groupId: readString(json['groupId']),
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
      sdp: readString(json['sdp']),
    );
  }

  final String groupId;
  final String from;
  final String fromUsername;
  final String sdp;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    'from': from,
    'fromUsername': fromUsername,
    'sdp': sdp,
  };
}

/// Inbound `group_call:answer` relay.
class GroupCallAnswerRelay {
  const GroupCallAnswerRelay({
    required this.groupId,
    required this.from,
    required this.fromUsername,
    required this.sdp,
  });

  factory GroupCallAnswerRelay.fromJson(Map<String, dynamic> json) {
    return GroupCallAnswerRelay(
      groupId: readString(json['groupId']),
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
      sdp: readString(json['sdp']),
    );
  }

  final String groupId;
  final String from;
  final String fromUsername;
  final String sdp;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    'from': from,
    'fromUsername': fromUsername,
    'sdp': sdp,
  };
}

/// Inbound `group_call:ice` relay. [candidate] stays a JSON string until the
/// transport decodes it.
class GroupCallIceRelay {
  const GroupCallIceRelay({
    required this.groupId,
    required this.from,
    required this.fromUsername,
    required this.candidate,
  });

  factory GroupCallIceRelay.fromJson(Map<String, dynamic> json) {
    return GroupCallIceRelay(
      groupId: readString(json['groupId']),
      from: readString(json['from']),
      fromUsername: readString(json['fromUsername']),
      candidate: readString(json['candidate']),
    );
  }

  final String groupId;
  final String from;
  final String fromUsername;
  final String candidate;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    'from': from,
    'fromUsername': fromUsername,
    'candidate': candidate,
  };
}

/// Inbound `group_call:sfu_credentials` — LiveKit URL + join token.
class SfuCredentialsPayload {
  const SfuCredentialsPayload({
    required this.groupId,
    required this.url,
    required this.token,
  });

  factory SfuCredentialsPayload.fromJson(Map<String, dynamic> json) {
    return SfuCredentialsPayload(
      groupId: readString(json['groupId']),
      url: readString(json['url']),
      token: readString(json['token']),
    );
  }

  final String groupId;
  final String url;
  final String token;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    'url': url,
    'token': token,
  };
}

/// Local view of one participant in a group call (wire userId + display
/// username). Media stays behind the controller so this model is pure.
class GroupCallParticipant {
  const GroupCallParticipant({required this.userId, required this.username});

  final String userId;
  final String username;

  @override
  bool operator ==(Object other) {
    return other is GroupCallParticipant &&
        other.userId == userId &&
        other.username == username;
  }

  @override
  int get hashCode => Object.hash(userId, username);
}
