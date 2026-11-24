// Call UI: the DM header call button, the incoming-call banner, and the
// in-call overlay. Media is faked (see `call_test_support.dart`), so no
// WebRTC platform channel is involved.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scattered_keyhole/src/models/models.dart';
import 'package:scattered_keyhole/src/net/chat_events.dart';
import 'package:scattered_keyhole/src/state/chat_controller.dart';

import 'call_test_support.dart';
import 'ui_test_support.dart';

void main() {
  late FakeSocketService fake;
  late FakeCallTransport transport;
  late ChatController controller;

  setUp(() {
    fake = FakeSocketService();
    transport = FakeCallTransport();
    controller = makeController(fake, callTransportFactory: () => transport);
  });

  tearDown(() => controller.dispose());

  Future<void> openDm(WidgetTester tester) async {
    usePhoneSize(tester);
    await pumpApp(tester, controller);
    signIn(fake);
    setUsers(fake, [aliceInfo, bobInfo]);
    await tester.pumpAndSettle();
    await tester.tap(find.text('alice'));
    await tester.pumpAndSettle();
  }

  void ring() {
    fake.fire(
      ChatEvents.callOffer,
      const CallOfferRelay(
        from: 'u-alice',
        fromUsername: 'alice',
        sdp: 'remote-offer',
      ),
    );
  }

  testWidgets('the DM header dials the peer from the call button',
      (tester) async {
    await openDm(tester);

    expect(find.byKey(const Key('start-call')), findsOneWidget);
    await tester.tap(find.byKey(const Key('start-call')));
    await tester.pumpAndSettle();

    expect(controller.callState, CallState.calling);
    expect(transport.log, contains('getUserMedia:true:true'));
    expect(find.byKey(const Key('call-overlay')), findsOneWidget);
    expect(find.text('Calling…'), findsWidgets);

    await tester.tap(find.byKey(const Key('end-call')));
    await tester.pumpAndSettle();

    expect(controller.callState, CallState.idle);
    expect(find.byKey(const Key('call-overlay')), findsNothing);
    expect(find.byKey(const Key('start-call')), findsOneWidget);
  });

  testWidgets('an incoming call rings and accepting connects', (tester) async {
    await openDm(tester);

    ring();
    await tester.pumpAndSettle();

    expect(controller.callState, CallState.incoming);
    expect(find.byKey(const Key('incoming-call-banner')), findsOneWidget);
    expect(find.text('Incoming call from alice'), findsOneWidget);

    await tester.tap(find.byKey(const Key('accept-call')));
    await tester.pumpAndSettle();

    expect(controller.callState, CallState.connected);
    expect(transport.log, contains('setRemoteDescription:offer:remote-offer'));
    expect(find.byKey(const Key('incoming-call-banner')), findsNothing);
    expect(find.byKey(const Key('call-overlay')), findsOneWidget);

    await tester.tap(find.byKey(const Key('end-call')));
    await tester.pumpAndSettle();

    expect(controller.callState, CallState.idle);
    expect(find.byKey(const Key('call-overlay')), findsNothing);
  });

  testWidgets('rejecting an incoming call returns to idle', (tester) async {
    await openDm(tester);

    ring();
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('reject-call')));
    await tester.pumpAndSettle();

    expect(controller.callState, CallState.idle);
    expect(find.byKey(const Key('incoming-call-banner')), findsNothing);
    expect(fake.payloadsOf(ChatEvents.callReject), hasLength(1));
  });

  testWidgets('group chats have no call button', (tester) async {
    usePhoneSize(tester);
    await pumpApp(tester, controller);
    signIn(fake);
    setUsers(fake, [aliceInfo, bobInfo]);
    setGroups(fake, [groupInfo()]);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Groups (1)'));
    await tester.pump();
    await tester.tap(find.text('Team'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('start-call')), findsNothing);
  });
}
