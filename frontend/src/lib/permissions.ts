// ── Tier-3 permission gate ──
// Shared decision (spec): groups = owner/admin only, DMs = either
// participant — the same admin concept as member add/remove. Item 4 later
// replaces these ad-hoc checks with the general toggle system.

import type { ConversationTarget, GroupInfo } from '../types';

export function isAdminOf(
  groups: readonly GroupInfo[],
  username: string | null,
  target: ConversationTarget,
): boolean {
  if (target.kind === 'dm') return true;
  if (username === null) return false;
  const group = groups.find((g) => g.groupId === target.groupId);
  if (group === undefined) return false;
  return group.members.find((m) => m.username === username)?.isAdmin === true;
}
