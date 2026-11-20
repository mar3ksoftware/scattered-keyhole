import '../models/message.dart';

// ── Pin slot rules (spec B) ──
// Single pin slot per conversation, client-side only — the server relays
// pin actions and gates who may send them. All decision logic lives here so
// the tests can exercise it without the controller.

/// What the relay's target looks like in local state right now.
enum PinTargetState { missing, present, deleted }

/// Locate the relay target inside the conversation named by [key]. A
/// tombstoned target counts as [PinTargetState.deleted] so the banner never
/// resurrects it.
PinTargetState pinTargetState(
  String key,
  String targetId,
  List<DecryptedMessage> messages,
  List<DecryptedGroupMessage> groupMessages,
) {
  if (key.startsWith('group:')) {
    final groupId = key.substring('group:'.length);
    DecryptedGroupMessage? found;
    for (final message in groupMessages) {
      if (message.id == targetId && message.groupId == groupId) {
        found = message;
        break;
      }
    }
    if (found == null) return PinTargetState.missing;
    return found.deleted ? PinTargetState.deleted : PinTargetState.present;
  }
  final peer = key.substring('dm:'.length);
  DecryptedMessage? found;
  for (final message in messages) {
    if (message.id == targetId &&
        (message.fromUsername == peer || message.toUsername == peer)) {
      found = message;
      break;
    }
  }
  if (found == null) return PinTargetState.missing;
  return found.deleted ? PinTargetState.deleted : PinTargetState.present;
}

/// Apply one `message:pinned` relay (or an optimistic set) to the pin map.
///
/// Returns the same map instance when nothing changes — that also makes
/// self-echoes idempotent no-ops. A pin of an unknown (or tombstoned) target
/// is ignored, never stored; an unpin is slot-wide and clears whatever the
/// slot pointed at.
Map<String, String> applyPin(
  Map<String, String> pins,
  String key,
  String? targetId, {
  PinTargetState targetState = PinTargetState.present,
}) {
  final current = pins[key];
  if (targetId == null) {
    // Unpin is slot-wide (v1): clear the slot whatever it pointed at.
    if (current == null) return pins;
    final next = Map<String, String>.from(pins);
    next.remove(key);
    return next;
  }
  if (targetState != PinTargetState.present) return pins;
  if (current == targetId) return pins;
  return <String, String>{...pins, key: targetId};
}

/// The message was tombstoned: a pin pointing at it must not survive.
Map<String, String> clearPinForMessage(
  Map<String, String> pins,
  String key,
  String targetId,
) {
  if (pins[key] != targetId) return pins;
  final next = Map<String, String>.from(pins);
  next.remove(key);
  return next;
}

/// The messages were purged by expiry: clear every slot that pointed at one.
Map<String, String> clearPurgedPins(
  Map<String, String> pins,
  Set<String> purgedIds,
) {
  var changed = false;
  final next = <String, String>{};
  for (final entry in pins.entries) {
    if (purgedIds.contains(entry.value)) {
      changed = true;
      continue;
    }
    next[entry.key] = entry.value;
  }
  return changed ? next : pins;
}

/// Action-menu entry for one message (spec B UI): the currently pinned
/// message offers the unpin label, any other message the pin label, and
/// users who may not pin see no entry at all.
String? pinMenuLabel({required bool isPinned, required bool canPin}) {
  if (!canPin) return null;
  return isPinned ? 'Unpin message' : 'Pin message';
}
