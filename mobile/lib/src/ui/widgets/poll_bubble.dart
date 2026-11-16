import 'package:flutter/material.dart';

import '../../models/models.dart';
import '../theme/app_theme.dart';

/// Spec D: `0 votes` / `1 vote` / `N votes`.
String formatVoteCount(int total) {
  if (total == 1) return '1 vote';
  return '$total votes';
}

/// Share of the votes [votes] holds, rounded like the web `Math.round`
/// (`0` while nobody voted) — spec D `NN%`.
int pollPercent(int votes, int total) {
  if (total == 0) return 0;
  return ((votes / total) * 100).round();
}

/// Vote options with percentage bars and the footer count — the native
/// counterpart of the web `PollBubble` (C3/C4). Props-driven so widget
/// tests can render any tally state without a controller.
class PollBubble extends StatelessWidget {
  const PollBubble({
    super.key,
    required this.poll,
    required this.tallies,
    required this.closed,
    required this.myVote,
    required this.canVote,
    required this.canClose,
    this.onVote,
    this.onClose,
  });

  /// The decrypted poll definition (question + options).
  final PollDefinition poll;

  /// Voter username → chosen option index (spec B3).
  final Map<String, int> tallies;

  /// Whether the poll was closed — tallies stay, voting stops (C4).
  final bool closed;

  /// Our current option index, or null when we have not voted.
  final int? myVote;

  /// False when closed or the message is a tombstone.
  final bool canVote;

  /// Author-only close affordance (B3).
  final bool canClose;

  final void Function(int option)? onVote;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    final total = tallies.length;
    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 180),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            poll.question,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              height: 1.35,
              color: AppColors.textBody,
            ),
          ),
          const SizedBox(height: 8),
          for (var index = 0; index < poll.options.length; index++)
            _PollOption(
              label: poll.options[index],
              percent: pollPercent(_votesFor(index), total),
              mine: myVote == index,
              enabled: canVote && onVote != null,
              closed: closed,
              onTap: onVote == null ? null : () => onVote!(index),
            ),
          const SizedBox(height: 6),
          Text(
            formatVoteCount(total),
            style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
          ),
          if (closed)
            const Padding(
              padding: EdgeInsets.only(top: 2),
              child: Text(
                'Poll closed',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                  color: AppColors.textSecondary,
                ),
              ),
            ),
          if (canClose && onClose != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  key: const Key('poll-close-button'),
                  onPressed: onClose,
                  child: const Text('Close poll', style: TextStyle(fontSize: 12)),
                ),
              ),
            ),
        ],
      ),
    );
  }

  int _votesFor(int option) {
    var votes = 0;
    for (final choice in tallies.values) {
      if (choice == option) votes += 1;
    }
    return votes;
  }
}

/// One tappable vote row: label, `NN%` and a slim progress bar.
class _PollOption extends StatelessWidget {
  const _PollOption({
    required this.label,
    required this.percent,
    required this.mine,
    required this.enabled,
    required this.closed,
    required this.onTap,
  });

  final String label;
  final int percent;
  final bool mine;
  final bool enabled;
  final bool closed;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: mine ? AppColors.accentTint : AppColors.fill,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: mine
                  ? AppColors.accentBorder
                  : closed
                  ? AppColors.border
                  : AppColors.border.withValues(alpha: 0.7),
            ),
          ),
          child: Opacity(
            opacity: closed ? 0.75 : 1,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        label,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: mine ? FontWeight.w600 : FontWeight.w400,
                          color: AppColors.textBody,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '$percent%',
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                ClipRRect(
                  borderRadius: BorderRadius.circular(999),
                  child: LinearProgressIndicator(
                    value: percent / 100,
                    minHeight: 6,
                    backgroundColor: AppColors.surface,
                    valueColor: AlwaysStoppedAnimation<Color>(
                      mine ? AppColors.accentSoft : AppColors.accent,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
