// ── Expiry: ingestion gate + purge cadence (spec C) ──
// Every decision lives here so the tests can drive it with a fake clock;
// the controller only wires the interval and the sweep call.

import 'dart:math' as math;

import '../models/message.dart';
import '../models/tier1.dart';
import 'conversation_keys.dart';
import 'pins.dart';

/// One sweeper pass drops expired messages; exported so the wiring test can
/// shrink the cadence instead of waiting ten real seconds.
const int purgeIntervalMs = 10000;

/// Ingestion gate (spec C): `exp <= now` at receive time drops the message
/// entirely — not stored, no unread/mention bump. A null (absent or
/// malformed, already dropped by the parser) or future expiry stores fine.
bool shouldStoreAtIngestion(int? expiresAt, int nowMs) {
  if (expiresAt == null) return true;
  return expiresAt > nowMs;
}

/// Past-or-now expiry at sweep time: remove from every store.
bool isExpiredAt(int? expiresAt, int nowMs) =>
    expiresAt != null && expiresAt <= nowMs;

/// Slice of state the sweeper operates on (mirrors the web PurgableState).
class PurgableState {
  const PurgableState({
    required this.messages,
    required this.groupMessages,
    required this.unread,
    required this.pins,
  });

  final List<DecryptedMessage> messages;
  final List<DecryptedGroupMessage> groupMessages;
  final Map<String, UnreadEntry> unread;
  final Map<String, String> pins;
}

/// One purge pass. Returns the input unchanged (same reference) when nothing
/// expired, so the caller can skip the state swap.
PurgableState purgeExpired(PurgableState state, int nowMs) {
  final messages = state.messages
      .where((message) => !isExpiredAt(message.expiresAt, nowMs))
      .toList();
  final groupMessages = state.groupMessages
      .where((message) => !isExpiredAt(message.expiresAt, nowMs))
      .toList();

  final keptIds = <String>{
    for (final message in messages) message.id,
    for (final message in groupMessages) message.id,
  };

  final purged = <Object>[];
  for (final message in state.messages) {
    if (!keptIds.contains(message.id)) purged.add(message);
  }
  for (final message in state.groupMessages) {
    if (!keptIds.contains(message.id)) purged.add(message);
  }
  if (purged.isEmpty) return state;

  final purgedIds = <String>{};
  final unread = Map<String, UnreadEntry>.from(state.unread);
  var unreadChanged = false;
  for (final message in purged) {
    purgedIds.add((message as dynamic).id as String);
    final isOwn = (message as dynamic).isOwn as bool;
    if (isOwn) continue;
    final key = conversationKeyOfMessage(message);
    final entry = unread[key];
    if (entry == null) continue;
    final count = math.max(0, entry.count - 1);
    unread[key] = UnreadEntry(
      count: count,
      mention: count == 0 ? false : entry.mention,
    );
    unreadChanged = true;
  }

  return PurgableState(
    messages: messages,
    groupMessages: groupMessages,
    unread: unreadChanged ? unread : state.unread,
    pins: clearPurgedPins(state.pins, purgedIds),
  );
}