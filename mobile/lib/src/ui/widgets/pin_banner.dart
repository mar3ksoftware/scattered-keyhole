import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Banner shown above the message list when a conversation has a pinned
/// message (spec B).
class PinBanner extends StatelessWidget {
  const PinBanner({
    super.key,
    required this.excerpt,
    required this.canUnpin,
    required this.onUnpin,
    this.onOpen,
  });

  final String excerpt;
  final bool canUnpin;
  final VoidCallback onUnpin;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('pin-banner'),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: const BoxDecoration(
        color: AppColors.surfaceGlass,
        border: Border(bottom: BorderSide(color: AppColors.border)),
      ),
      child: Row(
        children: [
          Expanded(
            child: GestureDetector(
              onTap: onOpen,
              child: Text(
                excerpt,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 13,
                  color: AppColors.textSecondary,
                ),
              ),
            ),
          ),
          if (canUnpin)
            TextButton(
              onPressed: onUnpin,
              child: const Text('Unpin'),
            ),
        ],
      ),
    );
  }
}
