import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:scattered_keyhole/src/models/models.dart';
import 'package:scattered_keyhole/src/state/chat_controller.dart';

import 'call_test_support.dart';
import 'ui_test_support.dart';

void main() {
  late FakeSocketService fake;
  late FakeCallTransport transport;
  late ChatController controller;

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    fake = FakeSocketService();
    transport = FakeCallTransport();
    controller = makeController(fake, callTransportFactory: () => transport);
  });

  tearDown(() => controller.dispose());

  Future<void> openDm(WidgetTester tester) async {
    usePhoneSize(tester);
    await pumpApp(tester, controller);
    signIn(fake);
    setUsers(fake, <UserInfo>[aliceInfo, bobInfo]);
    await tester.pumpAndSettle();
    await tester.tap(find.text('alice'));
    await tester.pumpAndSettle();
  }

  testWidgets('audio settings sheet renders defaults', (tester) async {
    usePhoneSize(tester);
    await pumpApp(tester, controller);
    signIn(fake);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('open-audio-settings')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('audio-settings-sheet')), findsOneWidget);
  });

  testWidgets('toggling echo cancellation updates the controller', (tester) async {
    usePhoneSize(tester);
    await pumpApp(tester, controller);
    signIn(fake);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('open-audio-settings')));
    await tester.pumpAndSettle();

    final before = controller.audioSettings.echoCancellation;
    await tester.tap(find.widgetWithText(SwitchListTile, 'Echo cancellation'));
    await tester.pumpAndSettle();

    expect(controller.audioSettings.echoCancellation, !before);
  });

  testWidgets('mute toggle flips the fake transport track state', (tester) async {
    await openDm(tester);

    await tester.tap(find.byKey(const Key('start-call')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('mute-toggle')), findsOneWidget);

    await tester.tap(find.byKey(const Key('mute-toggle')));
    await tester.pumpAndSettle();

    expect(controller.callMuted, isTrue);
    expect(transport.micEnabled, isFalse);

    await tester.tap(find.byKey(const Key('mute-toggle')));
    await tester.pumpAndSettle();

    expect(controller.callMuted, isFalse);
    expect(transport.micEnabled, isTrue);
  });

  testWidgets('PTT pointer down/up drives mute', (tester) async {
    await openDm(tester);

    await tester.tap(find.byKey(const Key('start-call')));
    await tester.pumpAndSettle();

    // Baseline: manually mute so the hold-to-talk override is observable.
    controller.toggleCallMute();
    await tester.pumpAndSettle();
    expect(transport.micEnabled, isFalse);

    final ptt = find.byKey(const Key('ptt-button'));
    expect(ptt, findsOneWidget);

    final gesture = await tester.press(ptt);
    await tester.pump();
    expect(transport.micEnabled, isTrue);

    await gesture.up();
    await tester.pump();
    expect(transport.micEnabled, isFalse);
  });
}
