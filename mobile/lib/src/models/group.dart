import 'json_utils.dart';

/// A member entry inside a [GroupInfo].
class GroupMember {
  const GroupMember({
    required this.userId,
    required this.username,
    required this.isAdmin,
    this.displayName,
  });

  factory GroupMember.fromJson(Map<String, dynamic> json) {
    return GroupMember(
      userId: readString(json['userId']),
      username: readString(json['username']),
      isAdmin: readBool(json['isAdmin']),
      displayName: json['displayName'] is String
          ? json['displayName'] as String
          : null,
    );
  }

  final String userId;
  final String username;
  final bool isAdmin;

  /// Optional profile display name; falls back to [username] when absent.
  final String? displayName;

  String get displayNameOrUsername => displayName ?? username;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'userId': userId,
    'username': username,
    'isAdmin': isAdmin,
    if (displayName != null) 'displayName': displayName,
  };

  @override
  bool operator ==(Object other) {
    return other is GroupMember &&
        other.userId == userId &&
        other.username == username &&
        other.isAdmin == isAdmin &&
        other.displayName == displayName;
  }

  @override
  int get hashCode => Object.hash(userId, username, isAdmin, displayName);
}

/// Mirrors `GroupInfo` from the backend contract.
class GroupInfo {
  const GroupInfo({
    required this.groupId,
    required this.name,
    required this.members,
    required this.createdBy,
    required this.createdAt,
    this.description = '',
    this.disappearing = 0,
    this.persistent = false,
  });

  factory GroupInfo.fromJson(Map<String, dynamic> json) {
    return GroupInfo(
      groupId: readString(json['groupId']),
      name: readString(json['name']),
      members: readList(
        json['members'],
      ).map((entry) => GroupMember.fromJson(asJsonMap(entry))).toList(),
      createdBy: readString(json['createdBy']),
      createdAt: readInt(json['createdAt']),
      description: json['description'] is String
          ? json['description'] as String
          : '',
      disappearing: readInt(json['disappearing']),
      persistent: json['persistent'] == true,
    );
  }

  final String groupId;
  final String name;
  final List<GroupMember> members;
  final String createdBy;
  final int createdAt;

  /// Optional group description (spec A); empty when never set.
  final String description;

  /// Disappearing-message timer in seconds for the whole group; 0 is off.
  final int disappearing;

  /// Whether messages in this room persist across server restarts (Tier-7).
  final bool persistent;

  List<String> get memberUsernames =>
      members.map((member) => member.username).toList(growable: false);

  bool hasMember(String username) =>
      members.any((member) => member.username == username);

  bool isAdmin(String? username) =>
      username != null &&
      members.any((member) => member.username == username && member.isAdmin);

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    'name': name,
    'members': members.map((member) => member.toJson()).toList(),
    'createdBy': createdBy,
    'createdAt': createdAt,
    'description': description,
    'disappearing': disappearing,
    'persistent': persistent,
  };

  GroupInfo copyWith({
    String? groupId,
    String? name,
    List<GroupMember>? members,
    String? createdBy,
    int? createdAt,
    String? description,
    int? disappearing,
    bool? persistent,
  }) {
    return GroupInfo(
      groupId: groupId ?? this.groupId,
      name: name ?? this.name,
      members: members ?? this.members,
      createdBy: createdBy ?? this.createdBy,
      createdAt: createdAt ?? this.createdAt,
      description: description ?? this.description,
      disappearing: disappearing ?? this.disappearing,
      persistent: persistent ?? this.persistent,
    );
  }

  @override
  bool operator ==(Object other) {
    return other is GroupInfo &&
        other.groupId == groupId &&
        other.name == name &&
        other.createdBy == createdBy &&
        other.createdAt == createdAt &&
        other.description == description &&
        other.disappearing == disappearing &&
        other.persistent == persistent &&
        _membersEqual(other.members, members);
  }

  static bool _membersEqual(List<GroupMember> a, List<GroupMember> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }

  @override
  int get hashCode => Object.hash(
    groupId,
    name,
    createdBy,
    createdAt,
    description,
    disappearing,
    persistent,
    Object.hashAll(members),
  );
}

/// Outbound `group:create` payload.
class GroupCreatePayload {
  const GroupCreatePayload({required this.name, required this.members, this.description = '', this.persistent = false});

  factory GroupCreatePayload.fromJson(Map<String, dynamic> json) {
    return GroupCreatePayload(
      name: readString(json['name']),
      members: readList(
        json['members'],
      ).map((entry) => readString(entry)).toList(),
      description: json['description'] is String
          ? json['description'] as String
          : '',
      persistent: json['persistent'] == true,
    );
  }

  final String name;
  final List<String> members;

  /// Optional description (spec A); omitted from the wire when empty.
  final String description;

  /// Whether messages in this room persist across server restarts (Tier-7).
  final bool persistent;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'name': name,
    'members': members,
    if (description.isNotEmpty) 'description': description,
    if (persistent) 'persistent': true,
  };
}

/// Targets one user inside a group — the payload of `group:member:add`,
/// `group:member:remove` and `group:kick:vote`.
class GroupTargetPayload {
  const GroupTargetPayload({required this.groupId, required this.username});

  factory GroupTargetPayload.fromJson(Map<String, dynamic> json) {
    return GroupTargetPayload(
      groupId: readString(json['groupId']),
      username: readString(json['username']),
    );
  }

  final String groupId;
  final String username;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    'username': username,
  };

  @override
  bool operator ==(Object other) {
    return other is GroupTargetPayload &&
        other.groupId == groupId &&
        other.username == username;
  }

  @override
  int get hashCode => Object.hash(groupId, username);
}

/// `group:member:removed` — sent only to the removed user. [reason] is
/// `'removed'` for an admin remove and `'kicked'` for a vote kick.
class GroupMemberRemovedPayload {
  const GroupMemberRemovedPayload({
    required this.groupId,
    required this.username,
    required this.reason,
  });

  factory GroupMemberRemovedPayload.fromJson(Map<String, dynamic> json) {
    return GroupMemberRemovedPayload(
      groupId: readString(json['groupId']),
      username: readString(json['username']),
      reason: readString(json['reason']),
    );
  }

  final String groupId;
  final String username;
  final String reason;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    'username': username,
    'reason': reason,
  };

  @override
  bool operator ==(Object other) {
    return other is GroupMemberRemovedPayload &&
        other.groupId == groupId &&
        other.username == username &&
        other.reason == reason;
  }

  @override
  int get hashCode => Object.hash(groupId, username, reason);
}

/// `group:kick:tally` — the current vote-kick state for one group.
/// [status] is `'active'`, `'passed'` or `'expired'`.
class KickTally {
  const KickTally({
    required this.groupId,
    required this.username,
    required this.votes,
    required this.required,
    required this.status,
    required this.expiresAt,
  });

  factory KickTally.fromJson(Map<String, dynamic> json) {
    return KickTally(
      groupId: readString(json['groupId']),
      username: readString(json['username']),
      votes: readList(
        json['votes'],
      ).map((entry) => readString(entry)).toList(),
      required: readInt(json['required']),
      status: readString(json['status']),
      expiresAt: readInt(json['expiresAt']),
    );
  }

  final String groupId;
  final String username;
  final List<String> votes;
  final int required;
  final String status;
  final int expiresAt;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    'username': username,
    'votes': votes,
    'required': required,
    'status': status,
    'expiresAt': expiresAt,
  };

  @override
  bool operator ==(Object other) {
    return other is KickTally &&
        other.groupId == groupId &&
        other.username == username &&
        other.required == required &&
        other.status == status &&
        other.expiresAt == expiresAt &&
        _votesEqual(other.votes, votes);
  }

  static bool _votesEqual(List<String> a, List<String> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }

  @override
  int get hashCode => Object.hash(
    groupId,
    username,
    required,
    status,
    expiresAt,
    Object.hashAll(votes),
  );
}

/// Outbound `group:update` payload — both fields optional; only the ones
/// present are applied server-side (spec A).
class GroupUpdatePayload {
  const GroupUpdatePayload({required this.groupId, this.name, this.description});

  factory GroupUpdatePayload.fromJson(Map<String, dynamic> json) {
    return GroupUpdatePayload(
      groupId: readString(json['groupId']),
      name: json['name'] is String ? json['name'] as String : null,
      description: json['description'] is String
          ? json['description'] as String
          : null,
    );
  }

  final String groupId;
  final String? name;
  final String? description;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'groupId': groupId,
    if (name != null) 'name': name,
    if (description != null) 'description': description,
  };
}

/// Inbound `group:updated` relay — the full group state after an apply.
class GroupUpdatedPayload {
  const GroupUpdatedPayload({
    required this.groupId,
    required this.name,
    required this.description,
    required this.u,
    required this.timestamp,
  });

  factory GroupUpdatedPayload.fromJson(Map<String, dynamic> json) {
    return GroupUpdatedPayload(
      groupId: readString(json['groupId']),
      name: readString(json['name']),
      description: json['description'] is String
          ? json['description'] as String
          : '',
      u: readString(json['u']),
      timestamp: readInt(json['timestamp']),
    );
  }

  final String groupId;
  final String name;
  final String description;

  /// Username of the admin who made the change.
  final String u;
  final int timestamp;
}
