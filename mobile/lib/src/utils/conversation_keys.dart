import '../models/message.dart';
import '../models/tier1.dart';

// ── Conversation keys (spec B/C): one key shape for every conversation ──

/// Key for a conversation target: `dm:<peer>` or `group:<id>`.
String conversationKeyFor(ConversationTarget target) => target.isGroup
    ? 'group:${target.groupId}'
    : 'dm:${target.username}';

/// The conversation a stored message belongs to — the peer is always "the
/// other party", so own messages key on their recipient.
String conversationKeyOfMessage(Object message) {
  if (message is DecryptedGroupMessage) return 'group:${message.groupId}';
  final private = message as DecryptedMessage;
  return 'dm:${private.isOwn ? private.toUsername : private.fromUsername}';
}

/// Scope of a relayed Tier-3 payload → conversation key. Relays carry the
/// receiver as `to` plus the acting username as `u`; the join-time heal emit
/// carries only the timer's peer in `to` (no `u`). Both shapes handled.
String? relayKeyFor({
  String? u,
  String? to,
  String? groupId,
  required String? myUsername,
}) {
  if (groupId != null) return 'group:$groupId';
  if (to != null && (u == null || u == myUsername)) return 'dm:$to';
  if (u != null) return 'dm:$u';
  if (to != null) return 'dm:$to';
  return null;
}
