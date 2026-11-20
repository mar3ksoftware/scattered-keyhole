import 'package:flutter_test/flutter_test.dart';
import 'package:scattered_keyhole/src/crypto/e2ee_session.dart';
import 'package:scattered_keyhole/src/models/models.dart';
import 'package:scattered_keyhole/src/net/chat_events.dart';
import 'package:scattered_keyhole/src/state/chat_controller.dart';
import 'package:scattered_keyhole/src/utils/envelope.dart';
import 'package:scattered_keyhole/src/utils/group_meta.dart';
import 'package:scattered_keyhole/src/utils/timer.dart';

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

  setUp(() {
    fake = FakeSocketService();
    controller = makeController(fake);
    signIn(fake);
    setUsers(fake, const <UserInfo>[meInfo, aliceInfo, bobInfo]);
  });

  tearDown(() => controller.dispose());

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

  Future<String> receiveAliceMessage(
    String body, {
    String id = 'in-1',
    int? expiresAt,
  }) async {
    final aliceSession = E2eeSession();
    await establishKeyWith(aliceSession, 'alice');
    final env = expiresAt == null
        ? wrapTextEnvelope(body)
        : wrapTextEnvelope(body, null, expiresAt);
    final payload = await aliceSession.encrypt('me', env);
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
      () => controller.messagesForPeer('alice').any((m) => m.id == id && m.body == body),
    );
    return id;
  }

  group('purgeExpired', () {
    test('removes expired messages, recomputes unread, clears pin', () async {
      final exp = DateTime.now().millisecondsSinceEpoch + 1000;
      final id = await receiveAliceMessage('hello', id: 'm-exp', expiresAt: exp);
      // bump unread
      // receiveAliceMessage already counted; ensure unread
      expect(controller.unreadFor(const ConversationTarget.dm('alice')).count, greaterThanOrEqualTo(1));

      // pin the message
      controller.sendPin('dm:alice', id, true);
      expect(controller.pinnedMessageId('dm:alice'), id);

      controller.purgeExpired(exp + 1000);
      expect(controller.messagesForPeer('alice').where((m) => m.id == id), isEmpty);
      expect(controller.pinnedMessageId('dm:alice'), isNull);
      expect(controller.unreadFor(const ConversationTarget.dm('alice')).count, 0);
    });
  });

  group('pins', () {
    test('unknown target ignored (no emit, no slot)', () async {
      final id = await receiveAliceMessage('hi', id: 'm1');
      // use a ghost id
      controller.sendPin('dm:alice', 'ghost', true);
      expect(fake.countOf(ChatEvents.messagePin), 0);
      expect(controller.pinnedMessageId('dm:alice'), isNull);
      // keep id referenced
      expect(controller.messagesForPeer('alice').any((m) => m.id == id), isTrue);
    });

    test('replace slot', () async {
      final a = await receiveAliceMessage('a', id: 'ma');
      final b = await receiveAliceMessage('b', id: 'mb');
      controller.sendPin('dm:alice', a, true);
      expect(controller.pinnedMessageId('dm:alice'), a);
      controller.sendPin('dm:alice', b, true);
      expect(controller.pinnedMessageId('dm:alice'), b);
    });

    test('unpin clears slot', () async {
      final a = await receiveAliceMessage('a', id: 'mu');
      controller.sendPin('dm:alice', a, true);
      controller.sendPin('dm:alice', a, false);
      expect(controller.pinnedMessageId('dm:alice'), isNull);
    });

    test('tombstone clears pin', () async {
      final a = await receiveAliceMessage('a', id: 'mt');
      controller.sendPin('dm:alice', a, true);
      expect(controller.pinnedMessageId('dm:alice'), a);
      fake.fire(
        ChatEvents.messageDeleted,
        MessageDeletedPayload(
          from: 'u-alice',
          fromUsername: 'alice',
          to: 'me',
          targetId: a,
          timestamp: 1,
        ),
      );
      expect(controller.pinnedMessageId('dm:alice'), isNull);
    });

    test('expiry clears pin pointing at purged', () async {
      final exp = DateTime.now().millisecondsSinceEpoch + 1000;
      final a = await receiveAliceMessage('a', id: 'me2', expiresAt: exp);
      controller.sendPin('dm:alice', a, true);
      controller.purgeExpired(exp + 1000);
      expect(controller.pinnedMessageId('dm:alice'), isNull);
    });

    test('optimistic rollback on message_rejected', () async {
      final a = await receiveAliceMessage('a', id: 'mr');
      controller.sendPin('dm:alice', a, true);
      expect(controller.pinnedMessageId('dm:alice'), a);
      // previous slot null -> rollback clears
      fake.fire(
        ChatEvents.messageRejected,
        const MessageRejectedPayload(reason: 'nope'),
      );
      expect(controller.pinnedMessageId('dm:alice'), isNull);
    });

    test('self-echo idempotent', () async {
      final a = await receiveAliceMessage('a', id: 'mse');
      controller.sendPin('dm:alice', a, true);
      final before = controller.pinnedMessageId('dm:alice');
      fake.fire(
        ChatEvents.messagePinned,
        MessagePinnedPayload(
          targetId: a,
          pinned: true,
          u: 'me',
          to: 'alice',
        ),
      );
      expect(controller.pinnedMessageId('dm:alice'), before);
    });
  });

  group('timer', () {
    test('send embeds exp when timer>0, not when off', () async {
      final peer = E2eeSession();
      await establishKeyWith(peer, 'alice');
      // off by default
      expect(await controller.sendMessage('alice', 'off-msg'), isTrue);
      final offPayload = fake.payloadsOf(ChatEvents.messageSend).last as EncryptedMessagePayload;
      final offPlain = await peer.decrypt('me', offPayload.ciphertext, offPayload.iv);
      expect(parseEnvelope(offPlain).expiresAt, isNull);

      controller.setDisappearing('dm:alice', 86400);
      expect(await controller.sendMessage('alice', 'on-msg'), isTrue);
      final onPayload = fake.payloadsOf(ChatEvents.messageSend).last as EncryptedMessagePayload;
      final onPlain = await peer.decrypt('me', onPayload.ciphertext, onPayload.iv);
      expect(parseEnvelope(onPlain).expiresAt, isNotNull);
    });

    test('relay both shapes (u present and absent) apply timer', () async {
      setGroups(fake, <GroupInfo>[groupInfo()]);
      // group shape with u
      fake.fire(
        ChatEvents.disappearingChanged,
        DisappearingChangedPayload(groupId: 'g-team', seconds: 86400, u: 'alice'),
      );
      expect(controller.timerSecondsFor(const ConversationTarget.group('g-team')), 86400);

      // dm join-heal shape (u absent)
      fake.fire(
        ChatEvents.disappearingChanged,
        DisappearingChangedPayload(to: 'alice', seconds: 604800),
      );
      expect(controller.timerSecondsFor(const ConversationTarget.dm('alice')), 604800);
    });

    test('presets helper and admin-disable via isAdminOf', () {
      final group = GroupInfo(
        groupId: 'g-team',
        name: 'Team',
        members: const <GroupMember>[
          GroupMember(userId: 'u-alice', username: 'alice', isAdmin: true),
          GroupMember(userId: 'u-me', username: 'me', isAdmin: false),
        ],
        createdBy: 'alice',
        createdAt: 1,
      );
      // admin
      expect(isAdminOf(<GroupInfo>[group], 'alice', const ConversationTarget.group('g-team')), isTrue);
      // non-admin disabled
      expect(isAdminOf(<GroupInfo>[group], 'me', const ConversationTarget.group('g-team')), isFalse);
      for (final s in const <int>[0, 86400, 604800, 2592000]) {
        expect(isPresetSeconds(s), isTrue);
      }
    });
  });

  group('metadata', () {
    test('group:updated applies full state incl description/disappearing', () {
      setGroups(fake, <GroupInfo>[groupInfo()]);
      fake.fire(
        ChatEvents.groupUpdated,
        GroupUpdatedPayload(
          groupId: 'g-team',
          name: 'Renamed',
          description: 'Notes',
          u: 'alice',
          timestamp: 1,
        ),
      );
      final g = controller.groups.firstWhere((x) => x.groupId == 'g-team');
      expect(g.name, 'Renamed');
      expect(g.description, 'Notes');
      // disappearing untouched (full state keeps other fields)
      expect(g.disappearing, 0);
    });

    test('unknown group ignored', () {
      setGroups(fake, <GroupInfo>[groupInfo()]);
      final before = controller.groups.length;
      fake.fire(
        ChatEvents.groupUpdated,
        GroupUpdatedPayload(
          groupId: 'ghost',
          name: 'Nope',
          description: 'Nope',
          u: 'alice',
          timestamp: 1,
        ),
      );
      expect(controller.groups.length, before);
      expect(controller.groups.any((g) => g.groupId == 'ghost'), isFalse);
    });

    test('description defaults empty', () {
      setGroups(fake, <GroupInfo>[groupInfo()]);
      final g = controller.groups.firstWhere((x) => x.groupId == 'g-team');
      expect(g.description, '');
    });
  });

  group('ingestion drop', () {
    test('past exp not stored and no unread bump', () async {
      final aliceSession = E2eeSession();
      await establishKeyWith(aliceSession, 'alice');
      final payload = await aliceSession.encrypt(
        'me',
        wrapTextEnvelope('hi', null, 1),
      );
      final beforeUnread = controller.unreadFor(const ConversationTarget.dm('alice')).count;
      fake.fire(
        ChatEvents.privateMessage,
        PrivateMessage(
          id: 'past-exp',
          from: 'u-alice',
          fromUsername: 'alice',
          to: 'u-me',
          toUsername: 'me',
          ciphertext: payload.ciphertext,
          iv: payload.iv,
          timestamp: 700,
        ),
      );
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(controller.messagesForPeer('alice').where((m) => m.id == 'past-exp'), isEmpty);
      expect(controller.unreadFor(const ConversationTarget.dm('alice')).count, beforeUnread);
    });
  });
}
