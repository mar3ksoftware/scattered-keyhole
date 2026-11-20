import 'package:flutter/material.dart';

import '../../utils/timer.dart';
import '../theme/app_theme.dart';

/// Inline panel mirroring the web `ConversationSettingsMenu`: a titled list of
/// the four disappearing-message presets (radio style with a checkmark on the
/// current value) plus an optional admin-only `Edit group` entry.
class ConversationSettingsMenu extends StatelessWidget {
  const ConversationSettingsMenu({
    super.key,
    this.timerSeconds = 0,
    this.disabled = false,
    this.onSelect,
    this.onSelectTimer,
    this.canEditGroup = false,
    this.onEditGroup,
  });

  final int timerSeconds;
  final bool disabled;
  final void Function(int seconds)? onSelect;
  final void Function(int seconds)? onSelectTimer;
  final bool canEditGroup;
  final VoidCallback? onEditGroup;

  void _select(int seconds) {
    if (disabled) return;
    (onSelect ?? onSelectTimer)?.call(seconds);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: Text(
            'Disappearing messages',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: AppColors.textMuted,
            ),
          ),
        ),
        for (final option in timerOptions)
          TextButton(
            onPressed: disabled ? null : () => _select(option.seconds),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(option.label),
                if (timerSeconds == option.seconds) const Text('✓'),
              ],
            ),
          ),
        if (canEditGroup)
          TextButton(
            onPressed: onEditGroup,
            child: const Text('Edit group'),
          ),
      ],
    );
  }
}
