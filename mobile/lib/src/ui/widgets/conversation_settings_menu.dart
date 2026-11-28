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
    this.topology,
    this.onTopology,
  });

  final int timerSeconds;
  final bool disabled;
  final void Function(int seconds)? onSelect;
  final void Function(int seconds)? onSelectTimer;
  final bool canEditGroup;
  final VoidCallback? onEditGroup;

  /// Current call topology for group conversations; null hides the section.
  final String? topology;

  /// Admin-only topology switch; null hides the section for non-admins.
  final void Function(String topology)? onTopology;

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
        if (onTopology != null && topology != null) ...[
          const Divider(height: 16),
          const Padding(
            padding: EdgeInsets.fromLTRB(12, 4, 12, 4),
            child: Text(
              'Call topology',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.textMuted,
              ),
            ),
          ),
          for (final option in const <(String, String)>[
            ('mesh', 'Mesh (up to 6)'),
            ('sfu', 'SFU (larger, less private)'),
          ])
            TextButton(
              key: Key('topology-switch-${option.$1}'),
              onPressed: disabled ? null : () => onTopology!(option.$1),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(option.$2),
                  if (topology == option.$1) const Text('✓'),
                ],
              ),
            ),
        ],
      ],
    );
  }
}
