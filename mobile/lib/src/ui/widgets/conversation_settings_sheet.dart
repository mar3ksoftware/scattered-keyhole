import 'package:flutter/material.dart';

import '../../state/chat_controller.dart';
import '../../models/models.dart';
import '../../utils/group_meta.dart';
import 'conversation_settings_menu.dart';

/// Shows the disappearing-messages settings as a bottom sheet.
///
/// Returns the selected preset in seconds, or `null` when dismissed or when
/// an Edit group action was taken.
Future<int?> showConversationSettingsSheet(
  BuildContext context, {
  int timerSeconds = 0,
  bool disabled = false,
  bool canEditGroup = false,
  VoidCallback? onEditGroup,
  ChatController? controller,
  ConversationTarget? target,
  GroupInfo? group,
}) async {
  int resolvedTimer = timerSeconds;
  bool resolvedDisabled = disabled;
  bool resolvedCanEdit = canEditGroup;
  VoidCallback? resolvedEdit = onEditGroup;

  if (controller != null && target != null) {
    resolvedTimer = controller.timerSecondsFor(target);
    resolvedDisabled = !isAdminOf(controller.groups, controller.me?.username, target);
  }
  if (group != null) {
    // description not needed here
  }

  final result = await showModalBottomSheet<int?>(
    context: context,
    backgroundColor: Colors.transparent,
    builder: (sheetContext) {
      return Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 20),
        child: ConversationSettingsMenu(
          timerSeconds: resolvedTimer,
          disabled: resolvedDisabled,
          canEditGroup: resolvedCanEdit,
          onEditGroup: resolvedEdit == null
              ? null
              : () {
                  Navigator.of(sheetContext).pop();
                  resolvedEdit();
                },
          onSelect: (seconds) => Navigator.of(sheetContext).pop(seconds),
        ),
      );
    },
  );
  return result;
}


