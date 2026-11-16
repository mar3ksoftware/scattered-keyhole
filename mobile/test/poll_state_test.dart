// Poll tally and close rules (spec B3): optimistic votes and closes with
// `message_rejected` rollbacks, plus the re-validated `poll:voted` /
// `poll:closed` relays through the shared fake SocketService.

import 'package:flutter_test/flutter_test.dart';
import 'package:scattered_keyhole/src/crypto/e2ee_session.dart';
import 'package:scattered_keyhole/src/models/models.dart';
import 'package:scattered_keyhole/src/net/chat_events.dart';
import 'package:scattered_keyhole/src/state/chat_controller.dart';
import 'package:scattered_keyhole/src/utils/envelope.dart';

import 'ui_test_support.dart';

Future<void> waitFor(
  bool Function() condition, {
  Duration timeout = const Duration(seconds: 5),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (!condition()) {
    if (DateTime.now().isAfter(deadline)) {
      fail('Timed out waiting for condition');
    }
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}

void main() {
  late FakeSocketService fake;
  late ChatController controller;
  late E2eeSession aliceSession;

  /// Derives a shared key between the controller and [peer]'s session the
  /// way the key exchange does over the wire (controller signs in as `me`).
  Future<void> establishKeyWith(E2eeSession peer, String peerUsername) async {
    final peerPublicKey = await peer.getPublicKey();
    fake.fire(
      ChatEvents.e2eePublicKey,
      E2eePublicKeyRelay(
        from: 'u-$peerUsername',
        fromUsername: peerUsername,
        publicKey: peerPublicKey,
      ),
    );
    await waitFor(() => controller.e2ee.hasSharedKey(peerUsername));
    final myPublicKey = await controller.e2ee.getPublicKey();
    await peer.deriveSharedSecret('me', myPublicKey);
  }

  /// Delivers a poll authored by alice, encrypted for us. Reuses the
  /// [aliceSession] established in setUp for repeat polls.
  Future<String> receiveAlicePoll({String id = 'alice-poll-1'}) async {
    final envelope = wrapPollEnvelope(
      'Lunch?',
      <String>['Pizza', 'Sushi'],
    )!;
    final payload = await aliceSession.encrypt('me', envelope);
    fake.fire(
      ChatEvents.privateMessage,
      PrivateMessage(
        id: id,
        from: 'u-alice',
        fromUsername: 'alice',
        to: 'u-me',
        toUsername: 'me',
        ciphertext: payload.ciphertext,
        iv: payload.iv,
        timestamp: 700,
      ),
    );
    await waitFor(
      () => controller
          .messagesForPeer('alice')
          .any((message) => message.id == id && message.poll != null),
    );
    return id;
  }

  /// Sends our own poll to alice and delivers the server's echo so the
  /// message lands in our own-message bucket with a known id.
  Future<String> sendOwnPoll({String id = 'own-poll-1'}) async {
    expect(
      await controller.sendPoll(
        'alice',
        'Lunch?',
        <String>['Pizza', 'Sushi'],
      ),
      isTrue,
    );
    final payload =
        fake.payloadsOf(ChatEvents.messageSend).last as EncryptedMessagePayload;
    fake.fire(
      ChatEvents.privateMessage,
      PrivateMessage(
        id: id,
        from: 'u-me',
        fromUsername: 'me',
        to: 'u-alice',
        toUsername: 'alice',
        ciphertext: payload.ciphertext,
        iv: payload.iv,
        timestamp: 1000,
      ),
    );
    await waitFor(
      () => controller
          .messagesForPeer('alice')
          .any((message) => message.id == id && message.poll != null),
    );
    return id;
  }

  void relayVote(String pollId, String username, int option) {
    fake.fire(
      ChatEvents.pollVoted,
      PollVotedPayload(pollId: pollId, option: option, u: username),
    );
  }

  void relayClose(String pollId, String username) {
    fake.fire(
      ChatEvents.pollClosed,
      PollClosedPayload(pollId: pollId, u: username),
    );
  }

  setUp(() async {
    fake = FakeSocketService();
    controller = makeController(fake);
    signIn(fake);
    setUsers(fake, const <UserInfo>[meInfo, aliceInfo, bobInfo]);
    aliceSession = E2eeSession();
    await establishKeyWith(aliceSession, 'alice');
  });

  tearDown(() => controller.dispose());

  group('poll message wiring (B1)', () {
    test('an inbound poll envelope stores the definition on the message', () async {
      final id = await receiveAlicePoll();
      final message = controller
          .messagesForPeer('alice')
          .firstWhere((entry) => entry.id == id);
      expect(message.poll, isNotNull);
      expect(message.poll!.question, 'Lunch?');
      expect(message.poll!.options, <String>['Pizza', 'Sushi']);
      expect(message.body, isNull);
      expect(message.isOwn, isFalse);
      expect(message.deleted, isFalse);
    });

    test('our own poll echo stores the definition as an own message', () async {
      final id = await sendOwnPoll();
      final message = controller
          .messagesForPeer('alice')
          .firstWhere((entry) => entry.id == id);
      expect(message.poll, isNotNull);
      expect(message.poll!.question, 'Lunch?');
      expect(message.isOwn, isTrue);
      expect(message.fromUsername, 'me');
    });

    test('an invalid poll definition sends nothing', () async {
      expect(
        await controller.sendPoll('alice', 'Q', <String>['Only']),
        isFalse,
      );
      expect(fake.countOf(ChatEvents.messageSend), 0);
    });
  });

  group('poll voting (B3)', () {
    test('our vote is optimistic and emits poll:vote with the option', () async {
      final pollId = await receiveAlicePoll();

      controller.votePoll(const ConversationTarget.dm('alice'), pollId, 1);

      expect(controller.pollTalliesFor(pollId), <String, int>{'me': 1});
      final payload =
          fake.payloadsOf(ChatEvents.pollVote).single as PollVotePayload;
      expect(payload.pollId, pollId);
      expect(payload.option, 1);
      expect(payload.to, 'alice');
      expect(payload.groupId, isNull);
    });

    test('an out-of-range option is refused locally', () async {
      final pollId = await receiveAlicePoll();

      controller.votePoll(const ConversationTarget.dm('alice'), pollId, 5);

      expect(fake.countOf(ChatEvents.pollVote), 0);
      expect(controller.pollTalliesFor(pollId), isEmpty);
    });

    test('an unknown poll id is refused locally', () {
      controller.votePoll(const ConversationTarget.dm('alice'), 'ghost', 0);

      expect(fake.countOf(ChatEvents.pollVote), 0);
      expect(controller.pollTalliesFor('ghost'), isEmpty);
    });

    test('votes on a closed poll are refused', () async {
      final pollId = await receiveAlicePoll();
      relayClose(pollId, 'alice');
      expect(controller.isPollClosed(pollId), isTrue);

      controller.votePoll(const ConversationTarget.dm('alice'), pollId, 0);

      expect(fake.countOf(ChatEvents.pollVote), 0);
      expect(controller.pollTalliesFor(pollId), isEmpty);
    });

    test('votes on a tombstoned poll are refused', () async {
      final pollId = await sendOwnPoll();
      controller.deleteMessage(const ConversationTarget.dm('alice'), pollId);
      final message = controller
          .messagesForPeer('alice')
          .firstWhere((entry) => entry.id == pollId);
      expect(message.deleted, isTrue);

      controller.votePoll(const ConversationTarget.dm('alice'), pollId, 0);

      expect(fake.countOf(ChatEvents.pollVote), 0);
      expect(controller.pollTalliesFor(pollId), isEmpty);
    });

    test('a relayed alice vote lands in the tallies', () async {
      final pollId = await receiveAlicePoll();

      relayVote(pollId, 'alice', 0);

      expect(controller.pollTalliesFor(pollId), <String, int>{'alice': 0});
    });

    test('our own echoed vote is ignored (self-echo)', () async {
      final pollId = await receiveAlicePoll();
      controller.votePoll(const ConversationTarget.dm('alice'), pollId, 0);
      expect(controller.pollTalliesFor(pollId), <String, int>{'me': 0});

      relayVote(pollId, 'me', 1);

      expect(controller.pollTalliesFor(pollId), <String, int>{'me': 0});
    });

    test('an out-of-range relayed option is ignored', () async {
      final pollId = await receiveAlicePoll();

      relayVote(pollId, 'alice', 5);

      expect(controller.pollTalliesFor(pollId), isEmpty);
    });

    test('a fractional option relayed as -1 is ignored', () async {
      final pollId = await receiveAlicePoll();
      // The wire parse is strict-int: a fractional option arrives as -1.
      fake.fire(
        ChatEvents.pollVoted,
        PollVotedPayload(pollId: pollId, option: -1, u: 'alice'),
      );

      expect(controller.pollTalliesFor(pollId), isEmpty);
    });

    test('a relayed vote for an unknown poll id is ignored', () {
      relayVote('ghost', 'alice', 0);

      expect(controller.pollTalliesFor('ghost'), isEmpty);
    });

    test('last write wins when the same voter changes their vote', () async {
      final pollId = await receiveAlicePoll();
      relayVote(pollId, 'alice', 0);

      relayVote(pollId, 'alice', 1);

      expect(controller.pollTalliesFor(pollId), <String, int>{'alice': 1});
    });

    test('relayed votes after the poll closed are ignored', () async {
      final pollId = await receiveAlicePoll();
      relayClose(pollId, 'alice');

      relayVote(pollId, 'alice', 0);

      expect(controller.pollTalliesFor(pollId), isEmpty);
    });

    test('message_rejected rolls our optimistic vote back', () async {
      final pollId = await receiveAlicePoll();
      controller.votePoll(const ConversationTarget.dm('alice'), pollId, 1);
      expect(controller.pollTalliesFor(pollId), <String, int>{'me': 1});

      fake.fire(
        ChatEvents.messageRejected,
        const MessageRejectedPayload(reason: 'Rate limit exceeded'),
      );

      expect(controller.pollTalliesFor(pollId), isEmpty);
    });
  });

  group('poll closing (B3)', () {
    test('our own close emits poll:close and marks the poll closed', () async {
      final pollId = await sendOwnPoll();
      expect(controller.isPollClosed(pollId), isFalse);

      controller.closePoll(const ConversationTarget.dm('alice'), pollId);

      expect(controller.isPollClosed(pollId), isTrue);
      final payload =
          fake.payloadsOf(ChatEvents.pollClose).single as PollClosePayload;
      expect(payload.pollId, pollId);
      expect(payload.to, 'alice');
      expect(payload.groupId, isNull);
    });

    test('we cannot close someone else\'s poll', () async {
      final pollId = await receiveAlicePoll();

      controller.closePoll(const ConversationTarget.dm('alice'), pollId);

      expect(controller.isPollClosed(pollId), isFalse);
      expect(fake.countOf(ChatEvents.pollClose), 0);
    });

    test('only the author\'s poll:closed relay applies', () async {
      final pollId = await receiveAlicePoll();

      relayClose(pollId, 'bob');
      expect(controller.isPollClosed(pollId), isFalse);

      relayClose(pollId, 'alice');
      expect(controller.isPollClosed(pollId), isTrue);
    });

    test('a poll:closed relay for an unknown poll id is ignored', () {
      relayClose('ghost', 'alice');

      expect(controller.isPollClosed('ghost'), isFalse);
    });

    test('closing is idempotent', () async {
      final pollId = await sendOwnPoll();

      controller.closePoll(const ConversationTarget.dm('alice'), pollId);
      controller.closePoll(const ConversationTarget.dm('alice'), pollId);
      relayClose(pollId, 'me');

      expect(controller.isPollClosed(pollId), isTrue);
      expect(fake.countOf(ChatEvents.pollClose), 1);
    });

    test('message_rejected reopens our optimistic close', () async {
      final pollId = await sendOwnPoll();
      controller.closePoll(const ConversationTarget.dm('alice'), pollId);
      expect(controller.isPollClosed(pollId), isTrue);

      fake.fire(
        ChatEvents.messageRejected,
        const MessageRejectedPayload(reason: 'Rate limit exceeded'),
      );

      expect(controller.isPollClosed(pollId), isFalse);
    });
  });
}
