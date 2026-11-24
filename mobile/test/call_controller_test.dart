// 1:1 call signaling: the state machine mirrors the web client's
// `ChatContext` handlers, so these tests pin the same ordering — capture,
// negotiate, buffer candidates until a remote description exists, tear down.

import 'package:flutter_test/flutter_test.dart';
import 'package:scattered_keyhole/src/crypto/e2ee_session.dart';
import 'package:scattered_keyhole/src/models/models.dart';
import 'package:scattered_keyhole/src/net/chat_events.dart';
import 'package:scattered_keyhole/src/state/chat_controller.dart';

import 'call_test_support.dart';
import 'chat_controller_test.dart' show FakeSocketService;

void main() {
  late FakeSocketService socket;
  late List<FakeCallTransport> transports;
  late ChatController controller;

  ChatController buildController() {
    transports = <FakeCallTransport>[];
    return ChatController(
      socket: socket,
      e2ee: E2eeSession(),
      errorClearDelay: const Duration(days: 1),
      sharedKeyTimeoutMs: 50,
      callTransportFactory: () {
        final transport = FakeCallTransport();
        transports.add(transport);
        return transport;
      },
    );
  }

  setUp(() {
    socket = FakeSocketService();
    controller = buildController();
  });

  tearDown(() => controller.dispose());

  void ring({String sdp = 'remote-offer'}) {
    socket.fire(
      ChatEvents.callOffer,
      CallOfferRelay(from: 'u-alice', fromUsername: 'alice', sdp: sdp),
    );
  }

  void deliverIce(String candidate) {
    socket.fire(
      ChatEvents.callIce,
      CallIceRelay(
        from: 'u-alice',
        fromUsername: 'alice',
        candidate: candidate,
      ),
    );
  }

  test('startCall captures media, offers, and emits call:offer', () async {
    await controller.startCall('alice');

    expect(controller.callState, CallState.calling);
    expect(controller.callPeer, 'alice');
    expect(transports, hasLength(1));
    expect(transports.single.log, <String>[
      'getUserMedia:true:true',
      'createPeerConnection',
      'addTracks',
      'createOffer',
      'setLocalDescription:offer:offer-sdp',
    ]);

    final payload =
        socket.payloadsOf(ChatEvents.callOffer).single as CallOfferPayload;
    expect(payload.to, 'alice');
    expect(payload.sdp, 'offer-sdp');
  });

  test('local ICE candidates are relayed to the peer', () async {
    await controller.startCall('alice');

    transports.single.emitIceCandidate('{"candidate":"c1"}');

    final payload =
        socket.payloadsOf(ChatEvents.callIce).single as CallIcePayload;
    expect(payload.to, 'alice');
    expect(payload.candidate, '{"candidate":"c1"}');
  });

  test('an inbound offer rings with the caller as peer', () {
    ring();

    expect(controller.callState, CallState.incoming);
    expect(controller.callPeer, 'alice');
    // Media is only captured once the call is accepted.
    expect(transports, isEmpty);
  });

  test('acceptCall applies the offer, flushes queued ICE, then answers',
      () async {
    ring();
    deliverIce('c1');
    deliverIce('c2');

    await controller.acceptCall();

    expect(controller.callState, CallState.connected);
    expect(transports.single.log, <String>[
      'getUserMedia:true:true',
      'createPeerConnection',
      'addTracks',
      'setRemoteDescription:offer:remote-offer',
      'addIceCandidate:c1',
      'addIceCandidate:c2',
      'createAnswer',
      'setLocalDescription:answer:answer-sdp',
    ]);

    final payload =
        socket.payloadsOf(ChatEvents.callAnswer).single as CallAnswerPayload;
    expect(payload.to, 'alice');
    expect(payload.sdp, 'answer-sdp');
  });

  test('ICE arriving after the remote description is applied immediately',
      () async {
    ring();
    await controller.acceptCall();
    transports.single.log.clear();

    deliverIce('c3');
    await pumpEventQueue();

    expect(transports.single.log, <String>['addIceCandidate:c3']);
  });

  test('the answer completes the caller side', () async {
    await controller.startCall('alice');
    transports.single.log.clear();

    socket.fire(
      ChatEvents.callAnswer,
      const CallAnswerRelay(
        from: 'u-alice',
        fromUsername: 'alice',
        sdp: 'remote-answer',
      ),
    );
    await pumpEventQueue();

    expect(controller.callState, CallState.connected);
    expect(transports.single.log, <String>[
      'setRemoteDescription:answer:remote-answer',
    ]);
  });

  test('candidates buffered before the answer are flushed after it', () async {
    await controller.startCall('alice');
    transports.single.log.clear();

    deliverIce('c1');
    expect(transports.single.log, isEmpty);

    socket.fire(
      ChatEvents.callAnswer,
      const CallAnswerRelay(
        from: 'u-alice',
        fromUsername: 'alice',
        sdp: 'remote-answer',
      ),
    );
    await pumpEventQueue();

    expect(transports.single.log, <String>[
      'setRemoteDescription:answer:remote-answer',
      'addIceCandidate:c1',
    ]);
  });

  test('endCall tells the peer, releases media and resets state', () async {
    await controller.startCall('alice');

    controller.endCall();

    expect(controller.callState, CallState.idle);
    expect(controller.callPeer, isNull);
    final payload =
        socket.payloadsOf(ChatEvents.callEnd).single as CallEndPayload;
    expect(payload.to, 'alice');

    await pumpEventQueue();
    expect(transports.single.closed, isTrue);
  });

  test('ending a call drops buffered signaling state', () async {
    await controller.startCall('alice');
    deliverIce('stale');
    controller.endCall();
    await pumpEventQueue();

    await controller.startCall('bob');
    final second = transports.last;
    second.log.clear();

    socket.fire(
      ChatEvents.callAnswer,
      const CallAnswerRelay(
        from: 'u-bob',
        fromUsername: 'bob',
        sdp: 'remote-answer',
      ),
    );
    await pumpEventQueue();

    expect(second.log, <String>[
      'setRemoteDescription:answer:remote-answer',
    ]);
  });

  test('rejectCall declines an incoming call', () async {
    ring();

    controller.rejectCall();

    expect(controller.callState, CallState.idle);
    expect(controller.callPeer, isNull);
    final payload =
        socket.payloadsOf(ChatEvents.callReject).single as CallEndPayload;
    expect(payload.to, 'alice');
    expect(transports, isEmpty);
  });

  test('a remote hang-up tears the call down without echoing it', () async {
    await controller.startCall('alice');

    socket.fire(
      ChatEvents.callEnd,
      const CallEndRelay(from: 'u-alice', fromUsername: 'alice'),
    );
    await pumpEventQueue();

    expect(controller.callState, CallState.idle);
    expect(transports.single.closed, isTrue);
    expect(socket.payloadsOf(ChatEvents.callEnd), isEmpty);
  });

  test('a remote rejection tears the call down', () async {
    await controller.startCall('alice');

    socket.fire(
      ChatEvents.callReject,
      const CallEndRelay(from: 'u-alice', fromUsername: 'alice'),
    );
    await pumpEventQueue();

    expect(controller.callState, CallState.idle);
    expect(transports.single.closed, isTrue);
    expect(socket.payloadsOf(ChatEvents.callReject), isEmpty);
  });

  test('a failed connection resets the call', () async {
    await controller.startCall('alice');

    transports.single.emitConnectionState('failed');
    await pumpEventQueue();

    expect(controller.callState, CallState.idle);
    expect(controller.callPeer, isNull);
    expect(transports.single.closed, isTrue);
  });

  test('a dropped connection resets the call', () async {
    await controller.startCall('alice');

    transports.single.emitConnectionState('disconnected');
    await pumpEventQueue();

    expect(controller.callState, CallState.idle);
  });

  test('startCall is a no-op while a call is already active', () async {
    await controller.startCall('alice');

    await controller.startCall('bob');

    expect(transports, hasLength(1));
    expect(controller.callPeer, 'alice');
    expect(socket.countOf(ChatEvents.callOffer), 1);
  });

  test('a second inbound offer is ignored while a call is active', () async {
    await controller.startCall('alice');

    socket.fire(
      ChatEvents.callOffer,
      const CallOfferRelay(from: 'u-bob', fromUsername: 'bob', sdp: 'other'),
    );

    expect(controller.callState, CallState.calling);
    expect(controller.callPeer, 'alice');
  });

  test('acceptCall does nothing when no call is ringing', () async {
    await controller.acceptCall();

    expect(controller.callState, CallState.idle);
    expect(transports, isEmpty);
  });

  test('a denied capture returns to idle with an error', () async {
    controller.dispose();
    final denied = FakeCallTransport()..denyMedia = true;
    controller = ChatController(
      socket: socket,
      e2ee: E2eeSession(),
      errorClearDelay: const Duration(days: 1),
      callTransportFactory: () => denied,
    );

    await controller.startCall('alice');

    expect(controller.callState, CallState.idle);
    expect(controller.callPeer, isNull);
    expect(controller.error, 'Could not start the call.');
    expect(denied.closed, isTrue);
  });
}
