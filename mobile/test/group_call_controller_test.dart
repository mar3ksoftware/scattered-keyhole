// Group call signaling: the mesh state machine mirrors the frozen contract
// (existing participants offer, joiners answer, ICE queues per peer) and the
// SFU path only asks for credentials and joins the injected room transport.

import 'package:flutter_test/flutter_test.dart';
import 'package:scattered_keyhole/src/calls/sfu_transport.dart';
import 'package:scattered_keyhole/src/crypto/e2ee_session.dart';
import 'package:scattered_keyhole/src/models/models.dart';
import 'package:scattered_keyhole/src/net/chat_events.dart';
import 'package:scattered_keyhole/src/state/chat_controller.dart';

import 'call_test_support.dart';
import 'chat_controller_test.dart' show FakeSocketService;
import 'sfu_test_support.dart';

void main() {
  late FakeSocketService socket;
  late List<FakeCallTransport> transports;
  late List<FakeSfuTransport> sfus;
  late ChatController controller;
  late bool failSfuConnect;

  setUp(() {
    socket = FakeSocketService();
    transports = <FakeCallTransport>[];
    sfus = <FakeSfuTransport>[];
    failSfuConnect = false;
    controller = ChatController(
      socket: socket,
      e2ee: E2eeSession(),
      errorClearDelay: const Duration(days: 1),
      sharedKeyTimeoutMs: 50,
      callTransportFactory: () {
        final transport = FakeCallTransport();
        transports.add(transport);
        return transport;
      },
      sfuTransportFactory: () {
        final sfu = FakeSfuTransport()..failConnect = failSfuConnect;
        sfus.add(sfu);
        return sfu;
      },
    );
  });

  tearDown(() => controller.dispose());

  void signIn() {
    socket.fire(
      ChatEvents.loginSuccess,
      const AuthSuccess(kind: 'login_success', userId: 'u-me', username: 'me'),
    );
  }

  GroupInfo group({String topology = CallTopology.mesh}) {
    return GroupInfo(
      groupId: 'g1',
      name: 'Group',
      members: const <GroupMember>[
        GroupMember(userId: 'u-me', username: 'me', isAdmin: true),
        GroupMember(userId: 'u-alice', username: 'alice', isAdmin: false),
        GroupMember(userId: 'u-bob', username: 'bob', isAdmin: false),
      ],
      createdBy: 'me',
      createdAt: 1,
      topology: topology,
    );
  }

  Future<void> startMeshCall({List<GroupCallPeer> peers = const []}) async {
    signIn();
    socket.fire(ChatEvents.activeGroups, <GroupInfo>[group()]);
    await controller.joinGroupCall('g1');
    socket.fire(
      ChatEvents.groupCallRoster,
      GroupCallRosterPayload(groupId: 'g1', peers: peers),
    );
    await pumpEventQueue();
  }

  test('joining a mesh room emits group_call:join and waits for the roster',
      () async {
    signIn();
    socket.fire(ChatEvents.activeGroups, <GroupInfo>[group()]);

    await controller.joinGroupCall('g1');

    expect(controller.groupCallState, GroupCallState.joining);
    expect(controller.groupCallId, 'g1');
    expect(socket.countOf(ChatEvents.groupCallJoin), 1);
    expect(socket.countOf(ChatEvents.groupCallSfuToken), 0);
    // Media is captured only once the server accepts the join.
    expect(transports, isEmpty);
  });

  test('the roster activates the call and captures the shared stream once',
      () async {
    await startMeshCall(
      peers: const <GroupCallPeer>[
        GroupCallPeer(userId: 'u-alice', username: 'alice'),
      ],
    );

    expect(controller.groupCallState, GroupCallState.active);
    expect(
      controller.groupCallParticipants.map((p) => p.userId),
      <String>['u-alice'],
    );
    // Only the capture transport exists; the joiner never offers.
    expect(transports, hasLength(1));
    expect(transports.single.log, <String>['getUserMedia:true:true']);
    expect(socket.countOf(ChatEvents.groupCallOffer), 0);
  });

  test('an existing participant offers to a newcomer', () async {
    await startMeshCall();
    transports.clear();

    socket.fire(
      ChatEvents.groupCallJoined,
      const GroupCallJoinedPayload(
        groupId: 'g1',
        from: 'u-bob',
        fromUsername: 'bob',
      ),
    );
    await pumpEventQueue();

    expect(
      controller.groupCallParticipants.map((p) => p.username),
      contains('bob'),
    );
    final offer =
        socket.payloadsOf(ChatEvents.groupCallOffer).single as GroupCallOfferPayload;
    expect(offer.groupId, 'g1');
    expect(offer.to, 'bob');
    expect(offer.sdp, 'offer-sdp');
    expect(transports, hasLength(1));
    expect(transports.single.log, <String>[
      'createPeerConnection',
      'addTracks',
      'createOffer',
      'setLocalDescription:offer:offer-sdp',
    ]);
  });

  test('the joiner answers an offer and flushes ICE queued before it',
      () async {
    await startMeshCall(
      peers: const <GroupCallPeer>[
        GroupCallPeer(userId: 'u-alice', username: 'alice'),
      ],
    );
    transports.clear();

    // Candidates can arrive before the offer; they must wait for the remote
    // description instead of being dropped.
    socket.fire(
      ChatEvents.groupCallIce,
      const GroupCallIceRelay(
        groupId: 'g1',
        from: 'u-alice',
        fromUsername: 'alice',
        candidate: 'c1',
      ),
    );
    await pumpEventQueue();
    socket.fire(
      ChatEvents.groupCallOffer,
      const GroupCallOfferRelay(
        groupId: 'g1',
        from: 'u-alice',
        fromUsername: 'alice',
        sdp: 'remote-offer',
      ),
    );
    await pumpEventQueue();

    final answer =
        socket.payloadsOf(ChatEvents.groupCallAnswer).single as GroupCallAnswerPayload;
    expect(answer.to, 'alice');
    expect(answer.sdp, 'answer-sdp');
    expect(transports.single.log, <String>[
      'createPeerConnection',
      'addTracks',
      'setRemoteDescription:offer:remote-offer',
      'addIceCandidate:c1',
      'createAnswer',
      'setLocalDescription:answer:answer-sdp',
    ]);
  });

  test('an answer applies the remote description and flushes queued ICE',
      () async {
    await startMeshCall();
    transports.clear();

    socket.fire(
      ChatEvents.groupCallJoined,
      const GroupCallJoinedPayload(
        groupId: 'g1',
        from: 'u-bob',
        fromUsername: 'bob',
      ),
    );
    await pumpEventQueue();
    socket.fire(
      ChatEvents.groupCallIce,
      const GroupCallIceRelay(
        groupId: 'g1',
        from: 'u-bob',
        fromUsername: 'bob',
        candidate: 'c9',
      ),
    );
    await pumpEventQueue();
    transports.single.log.clear();

    socket.fire(
      ChatEvents.groupCallAnswer,
      const GroupCallAnswerRelay(
        groupId: 'g1',
        from: 'u-bob',
        fromUsername: 'bob',
        sdp: 'answer-sdp',
      ),
    );
    await pumpEventQueue();

    expect(transports.single.log, <String>[
      'setRemoteDescription:answer:answer-sdp',
      'addIceCandidate:c9',
    ]);
  });

  test('a peer that joins while our roster is in flight still gets an offer',
      () async {
    signIn();
    socket.fire(ChatEvents.activeGroups, <GroupInfo>[group()]);
    await controller.joinGroupCall('g1');
    expect(controller.groupCallState, GroupCallState.joining);

    // Simultaneous join: this peer is not in the roster the server is about
    // to send us, so it must be remembered and offered to on activation.
    socket.fire(
      ChatEvents.groupCallJoined,
      const GroupCallJoinedPayload(
        groupId: 'g1',
        from: 'u-bob',
        fromUsername: 'bob',
      ),
    );
    await pumpEventQueue();
    expect(
      controller.groupCallParticipants.map((p) => p.username),
      contains('bob'),
    );
    expect(socket.countOf(ChatEvents.groupCallOffer), 0);

    socket.fire(
      ChatEvents.groupCallRoster,
      const GroupCallRosterPayload(groupId: 'g1', peers: <GroupCallPeer>[]),
    );
    await pumpEventQueue();

    final offer =
        socket.payloadsOf(ChatEvents.groupCallOffer).single as GroupCallOfferPayload;
    expect(offer.to, 'bob');
    expect(
      controller.groupCallParticipants.map((p) => p.username),
      contains('bob'),
    );
  });

  test('group_call:left closes that peer only', () async {
    await startMeshCall();
    socket.fire(
      ChatEvents.groupCallJoined,
      const GroupCallJoinedPayload(
        groupId: 'g1',
        from: 'u-bob',
        fromUsername: 'bob',
      ),
    );
    await pumpEventQueue();
    final bobTransport = transports.last;

    socket.fire(
      ChatEvents.groupCallLeft,
      const GroupCallLeftPayload(
        groupId: 'g1',
        from: 'u-bob',
        fromUsername: 'bob',
      ),
    );
    await pumpEventQueue();

    expect(bobTransport.closed, isTrue);
    expect(controller.groupCallParticipants, isEmpty);
    expect(controller.groupCallState, GroupCallState.active);
  });

  test('leaving emits group_call:leave and releases every transport',
      () async {
    await startMeshCall(
      peers: const <GroupCallPeer>[
        GroupCallPeer(userId: 'u-alice', username: 'alice'),
      ],
    );
    final capture = transports.single;

    controller.leaveGroupCall();
    await pumpEventQueue();

    final leave =
        socket.payloadsOf(ChatEvents.groupCallLeave).single as GroupCallLeavePayload;
    expect(leave.groupId, 'g1');
    expect(capture.closed, isTrue);
    expect(controller.groupCallState, GroupCallState.idle);
    expect(controller.groupCallId, isNull);
  });

  test('a 1:1 call blocks joining a group call', () async {
    signIn();
    socket.fire(ChatEvents.activeGroups, <GroupInfo>[group()]);
    await controller.startCall('alice');

    await controller.joinGroupCall('g1');

    expect(controller.error, 'End your current call first.');
    expect(controller.groupCallState, GroupCallState.idle);
    expect(socket.countOf(ChatEvents.groupCallJoin), 0);
  });

  test('a group call blocks dialing or accepting a 1:1 call', () async {
    await startMeshCall();

    await controller.startCall('alice');
    expect(controller.error, 'End your current call first.');
    expect(controller.callState, CallState.idle);
    expect(socket.countOf(ChatEvents.callOffer), 0);

    socket.fire(
      ChatEvents.callOffer,
      const CallOfferRelay(
        from: 'u-alice',
        fromUsername: 'alice',
        sdp: 'remote-offer',
      ),
    );
    await controller.acceptCall();
    expect(controller.callState, CallState.incoming);
    expect(socket.countOf(ChatEvents.callAnswer), 0);
  });

  test('an sfu room asks for a token instead of joining the mesh', () async {
    signIn();
    socket.fire(
      ChatEvents.activeGroups,
      <GroupInfo>[group(topology: CallTopology.sfu)],
    );

    await controller.joinGroupCall('g1');

    expect(socket.countOf(ChatEvents.groupCallJoin), 0);
    expect(socket.countOf(ChatEvents.groupCallSfuToken), 1);
    expect(controller.groupCallState, GroupCallState.joining);

    socket.fire(
      ChatEvents.groupCallSfuCredentials,
      const SfuCredentialsPayload(
        groupId: 'g1',
        url: 'wss://livekit.example',
        token: 'join-token',
      ),
    );
    await pumpEventQueue();

    expect(sfus, hasLength(1));
    expect(sfus.single.log, <String>[
      'connect:wss://livekit.example:join-token',
    ]);
    expect(controller.groupCallState, GroupCallState.active);

    sfus.single.setParticipants(const <SfuParticipant>[
      SfuParticipant(identity: 'u-alice', name: 'alice'),
    ]);
    expect(
      controller.groupCallParticipants.map((p) => p.username),
      <String>['alice'],
    );

    controller.leaveGroupCall();
    await pumpEventQueue();

    expect(sfus.single.disposed, isTrue);
    expect(controller.groupCallState, GroupCallState.idle);
    // SFU rooms leave by disposing the room, not through the mesh relay.
    expect(socket.countOf(ChatEvents.groupCallLeave), 0);
  });

  test('a failed SFU connect tears the call down with an error', () async {
    signIn();
    socket.fire(
      ChatEvents.activeGroups,
      <GroupInfo>[group(topology: CallTopology.sfu)],
    );
    await controller.joinGroupCall('g1');
    failSfuConnect = true;

    socket.fire(
      ChatEvents.groupCallSfuCredentials,
      const SfuCredentialsPayload(
        groupId: 'g1',
        url: 'wss://livekit.example',
        token: 'join-token',
      ),
    );
    await pumpEventQueue();

    expect(controller.groupCallState, GroupCallState.idle);
    expect(controller.error, 'Could not join the group call.');
  });

  test('a socket disconnect releases the call without emitting leave',
      () async {
    await startMeshCall(
      peers: const <GroupCallPeer>[
        GroupCallPeer(userId: 'u-alice', username: 'alice'),
      ],
    );
    final capture = transports.single;

    socket.fire(ChatEvents.disconnect);
    await pumpEventQueue();

    expect(controller.groupCallState, GroupCallState.idle);
    expect(capture.closed, isTrue);
    expect(socket.countOf(ChatEvents.groupCallLeave), 0);
  });

  test('the mesh-full server error reaches the user', () async {
    signIn();

    socket.fire(
      ChatEvents.error,
      const ErrorPayload(
        message:
            'This mesh call is full (6 participants max). Ask a group admin to switch this room to SFU for larger calls.',
      ),
    );

    expect(controller.error, contains('mesh call is full'));
  });

  test('setGroupTopology emits the admin switch payload', () {
    controller.setGroupTopology('g1', 'sfu');

    final payload =
        socket.payloadsOf(ChatEvents.groupTopology).single as GroupTopologyPayload;
    expect(payload.groupId, 'g1');
    expect(payload.topology, CallTopology.sfu);
  });
}
