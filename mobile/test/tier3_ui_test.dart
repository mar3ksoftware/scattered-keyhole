import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scattered_keyhole/src/models/models.dart';
import 'package:scattered_keyhole/src/state/chat_controller.dart';
import 'package:scattered_keyhole/src/ui/widgets/conversation_settings_menu.dart';
import 'package:scattered_keyhole/src/ui/widgets/edit_group_modal.dart';
import 'package:scattered_keyhole/src/ui/widgets/message_bubble.dart';
import 'package:scattered_keyhole/src/ui/widgets/pin_banner.dart';

import 'ui_test_support.dart';

void main() {
  late FakeSocketService fake;
  late ChatController controller;

  setUp(() {
    fake = FakeSocketService();
    controller = makeController(fake);
  });

  tearDown(() => controller.dispose());

  Future<void> pumpBubble(WidgetTester tester, Widget child) async {
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: ListView(children: [child]))),
    );
  }

  group('PinBanner', () {
    testWidgets('shows excerpt', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PinBanner(
              excerpt: 'pinned excerpt text',
              canUnpin: false,
              onUnpin: () {},
            ),
          ),
        ),
      );
      expect(find.text('pinned excerpt text'), findsOneWidget);
      expect(find.text('Unpin'), findsNothing);
    });

    testWidgets('Unpin only when canUnpin', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PinBanner(
              excerpt: 'x',
              canUnpin: true,
              onUnpin: () {},
            ),
          ),
        ),
      );
      expect(find.text('Unpin'), findsOneWidget);
    });
  });

  group('ConversationSettingsMenu', () {
    testWidgets('shows exact options + current checked', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ConversationSettingsMenu(
              timerSeconds: 86400,
              disabled: false,
              onSelectTimer: (_) {},
            ),
          ),
        ),
      );
      expect(find.text('Off'), findsOneWidget);
      expect(find.text('24 hours'), findsOneWidget);
      expect(find.text('7 days'), findsOneWidget);
      expect(find.text('30 days'), findsOneWidget);
      // checked mark on current
      expect(find.text('✓'), findsOneWidget);
    });

    testWidgets('admin disable disables options', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ConversationSettingsMenu(
              timerSeconds: 0,
              disabled: true,
              onSelectTimer: (_) {},
            ),
          ),
        ),
      );
      // TextButtons disabled -> onPressed null; find by type
      final buttons = tester.widgetList<TextButton>(find.byType(TextButton));
      for (final b in buttons) {
        expect(b.onPressed, isNull);
      }
    });

    testWidgets('Edit group entry visibility', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ConversationSettingsMenu(
              timerSeconds: 0,
              canEditGroup: false,
              onSelectTimer: (_) {},
            ),
          ),
        ),
      );
      expect(find.text('Edit group'), findsNothing);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ConversationSettingsMenu(
              timerSeconds: 0,
              canEditGroup: true,
              onEditGroup: () {},
              onSelectTimer: (_) {},
            ),
          ),
        ),
      );
      expect(find.text('Edit group'), findsOneWidget);
    });
  });

  group('EditGroupModal', () {
    testWidgets('Save disabled until valid; Cancel', (tester) async {
      final group = GroupInfo(
        groupId: 'g1',
        name: 'Team',
        members: const <GroupMember>[],
        createdBy: 'alice',
        createdAt: 1,
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: EditGroupModal(
              group: group,
              onSave: (_, _) {},
              onClose: () {},
            ),
          ),
        ),
      );
      // initially valid -> Save enabled
      final saveEnabled = tester.widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'Save'));
      expect(saveEnabled.onPressed, isNotNull);

      // clear name -> disabled
      await tester.enterText(find.byType(TextField).first, '');
      await tester.pump();
      final saveDisabled = tester.widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'Save'));
      expect(saveDisabled.onPressed, isNull);

      // Cancel present
      expect(find.text('Cancel'), findsOneWidget);
    });
  });

  group('Message menu', () {
    testWidgets('Pin message on unpinned when canPin', (tester) async {
      signIn(fake);
      await pumpBubble(
        tester,
        MessageBubble(
          text: 'msg',
          isOwn: false,
          sender: 'alice',
          id: 'm1',
          body: 'msg',
          timestamp: DateTime(2026, 3, 5, 12, 0).millisecondsSinceEpoch,
          controller: controller,
          target: const ConversationTarget.dm('alice'),
          onReply: (_) {},
          onPin: (_) {},
          canPin: true,
          isPinnedMessage: false,
        ),
      );
      await tester.longPress(find.text('msg'));
      await tester.pumpAndSettle();
      expect(find.text('Pin message'), findsOneWidget);
      expect(find.text('Unpin message'), findsNothing);
    });

    testWidgets('Unpin message on pinned', (tester) async {
      signIn(fake);
      await pumpBubble(
        tester,
        MessageBubble(
          text: 'msg',
          isOwn: false,
          sender: 'alice',
          id: 'm1',
          body: 'msg',
          timestamp: DateTime(2026, 3, 5, 12, 0).millisecondsSinceEpoch,
          controller: controller,
          target: const ConversationTarget.dm('alice'),
          onReply: (_) {},
          onUnpin: (_) {},
          canPin: true,
          isPinnedMessage: true,
        ),
      );
      await tester.longPress(find.text('msg'));
      await tester.pumpAndSettle();
      expect(find.text('Unpin message'), findsOneWidget);
      expect(find.text('Pin message'), findsNothing);
    });
  });
}
