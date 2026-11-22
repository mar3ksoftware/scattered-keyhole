// ── Group metadata validation + full-state apply (spec A) ──
// Mirrors the server's Zod rules so invalid edits never reach the wire;
// extracted from the edit form for node-test coverage.

import type { GroupInfo, GroupInfoJson } from '../types';
import { CONSTANTS } from '../types';

// Name 1..50 after trimming — same limits the server enforces.
export function isValidGroupName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= CONSTANTS.MAX_GROUP_NAME_LENGTH;
}

// Description 0..256: empty is fine, over-length is not.
export function isValidGroupDescription(description: string): boolean {
  return description.length <= CONSTANTS.MAX_GROUP_DESCRIPTION_LENGTH;
}

// Save stays disabled until both fields pass (spec A edit form).
export function canSaveGroupEdit(name: string, description: string): boolean {
  return isValidGroupName(name) && isValidGroupDescription(description);
}

// The create form only needs a valid name; the optional description may be
// any length up to the cap and does not gate the submit button.
export function canCreateGroup(name: string, description: string): boolean {
  return isValidGroupName(name) && isValidGroupDescription(description);
}

// Old servers predate Tier-3 and omit the two fields; normalize on ingress
// so downstream code can treat them as present.
export function normalizeGroupInfo(group: GroupInfoJson): GroupInfo {
  return {
    ...group,
    description: group.description ?? '',
    disappearing: group.disappearing ?? 0,
    persistent: group.persistent ?? false,
  };
}

// Full-state apply from `group:updated`: both fields travel together, so a
// known group gets the pair replaced (other fields untouched) and an
// unknown groupId leaves the list alone.
export function applyGroupUpdated(
  groups: readonly GroupInfo[],
  update: { readonly groupId: string; readonly name: string; readonly description: string },
): readonly GroupInfo[] {
  const index = groups.findIndex((g) => g.groupId === update.groupId);
  if (index === -1) return groups;
  const current = groups[index];
  if (current === undefined) return groups;
  const next = groups.slice();
  next[index] = { ...current, name: update.name, description: update.description };
  return next;
}
