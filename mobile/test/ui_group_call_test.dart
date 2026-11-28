// Group call UI: the group header controls, the in-call surface, the
// create-sheet topology picker and the admin topology switch. Media is faked
// so no WebRTC or LiveKit platform channel is involved.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scattered_keyhole/src/models/models.dart';
import 'package:scattered_keyhole/src/net/chat_events.dart';
import 'package:scattered_keyhole/src/state/chat_controller.dart';

import 'call_test_support.dart';
import 'sfu_test_support.dart';
import 'ui_test_support.dart';

void main() {
  late FakeSocketService fake;
  late List<FakeCallTransport> transports;
  late List<FakeSfuTransport> sfus;
  late ChatController controller;

  setUp(() {
    fake = FakeSocketService();
    transports = <FakeCallTransport>[];
    sfus = <FakeSfuTransport>[];
    controller = makeController(
      fake,
      callTransportFactory: () {
        final transport = FakeCallTransport();
        transports.add(transport);
        return transport;
      },
      sfuTransportFactory: () {
        final sfu = FakeSfuTransport();
        sfus.add(sfu);
        return sfu;
      },
    );
  });

  tearDown(() => controller.dispose());

  GroupInfo teamGroup({String topology = CallTopology.mesh}) {
    return GroupInfo(
      groupId: 'g-team',
      name: 'Team',
      members: const <GroupMember>[
        GroupMember(userId: 'u-me', username: 'me', isAdmin: true),
        GroupMember(userId: 'u-alice', username: 'alice', isAdmin: false),
        GroupMember(userId: 'u-bob', username: 'bob', isAdmin: false),
      ],
      createdBy: 'me',
      createdAt: 1000,
      topology: topology,
    );
  }

  Future<void> openGroup(
    WidgetTester tester, {
    String topology = CallTopology.mesh,
  }) async {
    usePhoneSize(tester);
    await pumpApp(tester, controller);
    signIn(fake);
    setUsers(fake, <UserInfo>[aliceInfo, bobInfo]);
    setGroups(fake, <GroupInfo>[teamGroup(topology: topology)]);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Groups (1)'));
    await tester.pump();
    await tester.tap(find.text('Team'));
    await tester.pumpAndSettle();
  }

  testWidgets('the group header starts a mesh call and shows the overlay',
      (tester) async {
    await openGroup(tester);

    expect(find.byKey(const Key('start-group-call')), findsOneWidget);
    await tester.tap(find.byKey(const Key('start-group-call')));
    await tester.pumpAndSettle();

    expect(controller.groupCallState, GroupCallState.joining);
    expect(fake.countOf(ChatEvents.groupCallJoin), 1);
    expect(find.byKey(const Key('group-call-overlay')), findsOneWidget);
    expect(find.text('Joining group call…'), findsOneWidget);
  });

  testWidgets('the roster fills the participant grid and the header count',
      (tester) async {
    await openGroup(tester);
    await tester.tap(find.byKey(const Key('start-group-call')));
    await tester.pumpAndSettle();

    fake.fire(
      ChatEvents.groupCallRoster,
      const GroupCallRosterPayload(
        groupId: 'g-team',
        peers: <GroupCallPeer>[
          GroupCallPeer(userId: 'u-alice', username: 'alice'),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(controller.groupCallState, GroupCallState.active);
    expect(find.byKey(const Key('group-participant-u-alice')), findsOneWidget);
    expect(find.text('Group call · 2'), findsOneWidget);
    expect(find.byKey(const Key('leave-group-call')), findsOneWidget);
  });

  testWidgets('leaving from the header tears the call down', (tester) async {
    await openGroup(tester);
    await tester.tap(find.byKey(const Key('start-group-call')));
    await tester.pumpAndSettle();
    fake.fire(
      ChatEvents.groupCallRoster,
      const GroupCallRosterPayload(groupId: 'g-team', peers: <GroupCallPeer>[]),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('leave-group-call')));
    await tester.pumpAndSettle();

    expect(controller.groupCallState, GroupCallState.idle);
    expect(fake.countOf(ChatEvents.groupCallLeave), 1);
    expect(find.byKey(const Key('group-call-overlay')), findsNothing);
    expect(find.byKey(const Key('start-group-call')), findsOneWidget);
  });

  testWidgets('an sfu room shows the disclosure and asks for a token',
      (tester) async {
    await openGroup(tester, topology: CallTopology.sfu);

    await tester.tap(find.byKey(const Key('start-group-call')));
    await tester.pumpAndSettle();

    expect(fake.countOf(ChatEvents.groupCallSfuToken), 1);
    expect(fake.countOf(ChatEvents.groupCallJoin), 0);
    expect(
      find.text(
        'SFU room — this server forwards call media (less private than mesh).',
      ),
      findsOneWidget,
    );
  });

  testWidgets('the create sheet defaults to mesh and sends the chosen topology',
      (tester) async {
    usePhoneSize(tester);
    await pumpApp(tester, controller);
    signIn(fake);
    setUsers(fake, <UserInfo>[aliceInfo, bobInfo]);
    setGroups(fake, <GroupInfo>[teamGroup()]);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Groups (1)'));
    await tester.pump();
    await tester.tap(find.text('Create Group'));
    await tester.pumpAndSettle();

    expect(find.text('Mesh (up to 6)'), findsOneWidget);
    expect(find.text('SFU (larger, less private)'), findsOneWidget);

    await tester.tap(find.byKey(const Key('topology-sfu')));
    await tester.pump();
    await tester.enterText(find.byType(TextField).first, 'New Group');
    await tester.tap(find.byKey(const ValueKey('member-checkbox-alice')));
    await tester.pump();
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();

    final payload =
        fake.payloadsOf(ChatEvents.groupCreate).single as GroupCreatePayload;
    expect(payload.topology, CallTopology.sfu);
  });

  testWidgets('an admin can switch the topology from conversation settings',
      (tester) async {
    await openGroup(tester);

    await tester.tap(find.byIcon(Icons.tune));
    await tester.pumpAndSettle();
    expect(find.text('Call topology'), findsOneWidget);

    await tester.tap(find.byKey(const Key('topology-switch-sfu')));
    await tester.pumpAndSettle();

    final payload =
        fake.payloadsOf(ChatEvents.groupTopology).single as GroupTopologyPayload;
    expect(payload.groupId, 'g-team');
    expect(payload.topology, CallTopology.sfu);
  });
}
