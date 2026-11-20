import '../models/group.dart';
import '../models/tier1.dart';

// ── Group metadata validation + full-state apply (spec A) ──
// Mirrors the server's Zod rules so invalid edits never reach the wire;
// extracted from the edit form for test coverage.

/// Frozen limits from the backend contract.
const int maxGroupNameLength = 50;
const int maxGroupDescriptionLength = 256;

/// Name 1..50 after trimming — same limits the server enforces.
bool isValidGroupName(String name) {
  final trimmed = name.trim();
  return trimmed.isNotEmpty && trimmed.length <= maxGroupNameLength;
}

/// Description 0..256: empty is fine, over-length is not.
bool isValidGroupDescription(String description) =>
    description.length <= maxGroupDescriptionLength;

/// Save stays disabled until both fields pass (spec A edit form).
bool canSaveGroupEdit(String name, String description) =>
    isValidGroupName(name) && isValidGroupDescription(description);

/// The create form only needs a valid name; the optional description may be
/// any length up to the cap and does not gate the submit button.
bool canCreateGroup(String name, String description) =>
    isValidGroupName(name) && isValidGroupDescription(description);

/// Full-state apply from `group:updated`: both fields travel together, so a
/// known group gets the pair replaced (other fields untouched) and an
/// unknown groupId leaves the list alone (returns the same instance).
List<GroupInfo> applyGroupUpdated(
  List<GroupInfo> groups,
  GroupUpdatedPayload update,
) {
  final index = groups.indexWhere((group) => group.groupId == update.groupId);
  if (index == -1) return groups;
  final current = groups[index];
  final next = List<GroupInfo>.of(groups);
  next[index] = current.copyWith(name: update.name, description: update.description);
  return next;
}

/// Who may change this conversation's settings: admins in groups, either
/// participant in DMs (spec: the same admin concept as member add/remove).
bool isAdminOf(List<GroupInfo> groups, String? username, ConversationTarget target) {
  if (target.isDm) return true;
  if (username == null) return false;
  for (final group in groups) {
    if (group.groupId != target.groupId) continue;
    for (final member in group.members) {
      if (member.username == username) return member.isAdmin;
    }
    return false;
  }
  return false;
}
