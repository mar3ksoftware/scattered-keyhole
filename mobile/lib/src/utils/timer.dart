import '../models/group.dart';
import '../models/tier1.dart';

// ── Conversation timer presets + send decision (spec C) ──
// The exact option labels live here so the settings UI and the tests share
// one source; the controller only calls these at send time.

class TimerOption {
  const TimerOption({required this.seconds, required this.label});

  final int seconds;
  final String label;
}

/// Presets exactly as frozen in spec D — order is the display order.
const List<TimerOption> timerOptions = <TimerOption>[
  TimerOption(seconds: 0, label: 'Off'),
  TimerOption(seconds: 86400, label: '24 hours'),
  TimerOption(seconds: 604800, label: '7 days'),
  TimerOption(seconds: 2592000, label: '30 days'),
];

/// The preset seconds union from the backend contract.
const List<int> disappearingPresets = <int>[0, 86400, 604800, 2592000];

bool isPresetSeconds(int seconds) => disappearingPresets.contains(seconds);

String timerLabelFor(int seconds) {
  for (final option in timerOptions) {
    if (option.seconds == seconds) return option.label;
  }
  return 'Off';
}

/// Whether an outgoing envelope for this conversation must carry `exp`:
/// only a timer > 0 stamps one, computed at wrap time by `expForTimer`.
bool embedsExpiry(int seconds) => seconds > 0;

/// The timer currently in force for a conversation: groups read the
/// [GroupInfo] field, DMs the client-side map keyed like every other
/// conversation key. Missing entries mean the timer is off.
int timerSecondsOf(
  List<GroupInfo> groups,
  Map<String, int> dmDisappearing,
  ConversationTarget target,
) {
  if (target.isGroup) {
    for (final group in groups) {
      if (group.groupId == target.groupId) return group.disappearing;
    }
    return 0;
  }
  return dmDisappearing['dm:${target.username}'] ?? 0;
}
