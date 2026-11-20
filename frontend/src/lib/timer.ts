// ── Conversation timer presets + send decision (spec C) ──
// The exact option labels live here so the settings UI and the tests share
// one source; ChatContext only calls these at send time.

import type { ConversationTarget, GroupInfo } from '../types';
import { CONSTANTS } from '../types';

export type TimerOption = {
  readonly seconds: number;
  readonly label: string;
};

// Presets exactly as frozen in spec D — order is the display order.
export const TIMER_OPTIONS: readonly TimerOption[] = [
  { seconds: 0, label: 'Off' },
  { seconds: 86400, label: '24 hours' },
  { seconds: 604800, label: '7 days' },
  { seconds: 2592000, label: '30 days' },
];

export function isPresetSeconds(seconds: number): boolean {
  return (CONSTANTS.DISAPPEARING_PRESETS as readonly number[]).includes(seconds);
}

export function timerLabelFor(seconds: number): string {
  return TIMER_OPTIONS.find((option) => option.seconds === seconds)?.label ?? 'Off';
}

// Whether an outgoing envelope for this conversation must carry `exp`:
// only a timer > 0 stamps one, computed at wrap time by expForTimer.
export function embedsExpiry(seconds: number): boolean {
  return seconds > 0;
}

// The timer currently in force for a conversation: groups read the
// GroupInfo field, DMs the client-side map keyed like every other
// conversation key. Missing entries mean the timer is off.
export function timerSecondsOf(
  groups: readonly GroupInfo[],
  dmDisappearing: Readonly<Record<string, number>>,
  target: ConversationTarget,
): number {
  if (target.kind === 'group') {
    return groups.find((g) => g.groupId === target.groupId)?.disappearing ?? 0;
  }
  return dmDisappearing[`dm:${target.username}`] ?? 0;
}

export type TimerState = {
  readonly groups: readonly GroupInfo[];
  readonly dmDisappearing: Readonly<Record<string, number>>;
};

// Apply one `disappearing:set` / `disappearing:changed` to local state.
// Groups update GroupInfo (unknown groups are ignored), DMs the timer map;
// an unchanged value returns the same references so the reducer can skip
// the state swap.
export function applyDisappearing(state: TimerState, key: string, seconds: number): TimerState {
  if (key.startsWith('group:')) {
    const groupId = key.slice('group:'.length);
    const index = state.groups.findIndex((g) => g.groupId === groupId);
    if (index === -1) return state;
    const current = state.groups[index];
    if (current === undefined || current.disappearing === seconds) return state;
    const groups = state.groups.slice();
    groups[index] = { ...current, disappearing: seconds };
    return { ...state, groups };
  }
  if (state.dmDisappearing[key] === seconds) return state;
  return { ...state, dmDisappearing: { ...state.dmDisappearing, [key]: seconds } };
}
