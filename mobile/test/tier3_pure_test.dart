// Tier-3 pure lib unit tests (spec: disappearing pins/timers/group meta).
//
// No Flutter binding required beyond `flutter_test`'s `test` runner.

import 'package:flutter_test/flutter_test.dart';
import 'package:scattered_keyhole/src/models/group.dart';
import 'package:scattered_keyhole/src/models/message.dart';
import 'package:scattered_keyhole/src/models/tier1.dart';
import 'package:scattered_keyhole/src/utils/conversation_keys.dart';
import 'package:scattered_keyhole/src/utils/envelope.dart';
import 'package:scattered_keyhole/src/utils/group_meta.dart';
import 'package:scattered_keyhole/src/utils/pins.dart';
import 'package:scattered_keyhole/src/utils/purge.dart';
import 'package:scattered_keyhole/src/utils/timer.dart';

void main() {
  // ── envelope expForTimer / parseEnvelope ──────────────────────────────
  test('expForTimer: timer > 0 stamps now + seconds*1000, timer 0 -> null', () {
    const now = 1700000000000;
    expect(expForTimer(86400, now), now + 86400 * 1000);
    expect(expForTimer(0, now), isNull);
    expect(expForTimer(604800, now), now + 604800 * 1000);
  });

  test('parseEnvelope keeps a future expiry on the parsed envelope', () {
    const future = 1700000060000;
    final parsed = parseEnvelope('{"t":"text","b":"hi","exp":$future}');
    expect(parsed.expiresAt, future);
    expect(parsed.isText, isTrue);
    expect(parsed.text, 'hi');
  });

  test('parseEnvelope drops malformed/absent exp to null but keeps message', () {
    for (final bad in <Object>['soon', 0, -5, double.nan, double.infinity]) {
      String src;
      if (bad is String) {
        src = '{"t":"text","b":"hi","exp":"$bad"}';
      } else if (bad is double && !bad.isFinite) {
        src = '{"t":"text","b":"hi","exp":null}';
      } else {
        src = '{"t":"text","b":"hi","exp":$bad}';
      }
      final parsed = parseEnvelope(src);
      expect(parsed.expiresAt, isNull, reason: '$bad should drop the field');
      expect(parsed.isText, isTrue);
    }
    final absent = parseEnvelope('{"t":"text","b":"hi"}');
    expect(absent.expiresAt, isNull);
  });

  test('parseEnvelope keeps a past expiry value (ingestion gate drops later)', () {
    const past = 1700000000000 - 1000;
    final parsed = parseEnvelope('{"t":"text","b":"hi","exp":$past}');
    expect(parsed.expiresAt, past);
    expect(shouldStoreAtIngestion(parsed.expiresAt, 1700000000000), isFalse);
  });

  // ── purge gate ────────────────────────────────────────────────────────
  test('shouldStoreAtIngestion true for future/absent, false for past-or-now', () {
    const now = 1700000000000;
    expect(shouldStoreAtIngestion(null, now), isTrue);
    expect(shouldStoreAtIngestion(now + 1, now), isTrue);
    expect(shouldStoreAtIngestion(now, now), isFalse);
    expect(shouldStoreAtIngestion(now - 1, now), isFalse);
  });

  test('isExpiredAt true only for past-or-now expiry', () {
    const now = 1700000000000;
    expect(isExpiredAt(null, now), isFalse);
    expect(isExpiredAt(now - 1, now), isTrue);
    expect(isExpiredAt(now, now), isTrue);
    expect(isExpiredAt(now + 1, now), isFalse);
  });

  // ── pins ──────────────────────────────────────────────────────────────
  test('pinTargetState unknown/present/deleted for DM and group', () {
    const key = 'dm:bob';
    final msgs = <DecryptedMessage>[
      DecryptedMessage(
        id: 'm1',
        from: 'u-alice',
        fromUsername: 'alice',
        to: 'u-bob',
        toUsername: 'bob',
        plaintext: '{}',
        body: 'hi',
        reply: null,
        edited: false,
        deleted: false,
        timestamp: 1,
        isOwn: false,
        decryptionFailed: false,
        media: null,
        poll: null,
      ),
    ];
    expect(pinTargetState(key, 'ghost', msgs, const <DecryptedGroupMessage>[]),
        PinTargetState.missing);
    final tombstoned = <DecryptedMessage>[
      msgs.first.copyWith(deleted: true),
    ];
    expect(pinTargetState(key, 'm1', tombstoned, const <DecryptedGroupMessage>[]),
        PinTargetState.deleted);
    expect(pinTargetState(key, 'm1', msgs, const <DecryptedGroupMessage>[]),
        PinTargetState.present);

    const gkey = 'group:grp-1';
    final gmsgs = <DecryptedGroupMessage>[
      DecryptedGroupMessage(
        id: 'g1',
        groupId: 'grp-1',
        from: 'u-alice',
        fromUsername: 'alice',
        plaintext: '{}',
        body: 'hi',
        reply: null,
        edited: false,
        deleted: false,
        timestamp: 1,
        isOwn: false,
        decryptionFailed: false,
        media: null,
        poll: null,
      ),
    ];
    expect(pinTargetState(gkey, 'g1', const <DecryptedMessage>[], gmsgs),
        PinTargetState.present);
    expect(pinTargetState(gkey, 'other', const <DecryptedMessage>[], gmsgs),
        PinTargetState.missing);
  });

  test('applyPin ignore unknown, replace, unpin, tombstone, idempotent, rollback', () {
    const key = 'dm:bob';
    final pins = <String, String>{};
    // unknown ignored
    expect(applyPin(pins, key, 'ghost', targetState: PinTargetState.missing), pins);
    // replace
    final first = applyPin(pins, key, 'm1', targetState: PinTargetState.present);
    expect(first[key], 'm1');
    final second = applyPin(first, key, 'm2', targetState: PinTargetState.present);
    expect(second[key], 'm2');
    expect(second.length, 1);
    // unpin
    final cleared = applyPin(second, key, null);
    expect(cleared.containsKey(key), isFalse);
    expect(applyPin(cleared, key, null), same(cleared));
    // tombstone never lands
    final tomb = applyPin(pins, key, 'm1', targetState: PinTargetState.deleted);
    expect(tomb.containsKey(key), isFalse);
    // idempotent self-echo
    expect(applyPin(first, key, 'm1', targetState: PinTargetState.present), same(first));
    // rollback: optimistic replace then restore
    final optimistic = applyPin(first, key, 'm2', targetState: PinTargetState.present);
    expect(optimistic[key], 'm2');
    final rolled = applyPin(optimistic, key, 'm1', targetState: PinTargetState.present);
    expect(rolled[key], 'm1');
    // fresh pin then unpin rollback
    final fresh = applyPin(pins, key, 'm3', targetState: PinTargetState.present);
    expect(applyPin(fresh, key, null)[key], isNull);
  });

  test('clearPinForMessage and clearPurgedPins', () {
    const key = 'dm:bob';
    final pinned = applyPin(<String, String>{}, key, 'm1',
        targetState: PinTargetState.present);
    expect(clearPinForMessage(pinned, key, 'm1').containsKey(key), isFalse);
    final other = applyPin(<String, String>{}, key, 'm2',
        targetState: PinTargetState.present);
    expect(clearPinForMessage(other, key, 'm1'), same(other));
    final multi = <String, String>{key: 'm1', 'group:grp-1': 'g1'};
    final purged = clearPurgedPins(multi, <String>{'m1'});
    expect(purged[key], isNull);
    expect(purged['group:grp-1'], 'g1');
    expect(clearPurgedPins(multi, <String>{'nope'}), same(multi));
  });

  test('pinMenuLabel exact strings', () {
    expect(pinMenuLabel(isPinned: false, canPin: true), 'Pin message');
    expect(pinMenuLabel(isPinned: true, canPin: true), 'Unpin message');
    expect(pinMenuLabel(isPinned: false, canPin: false), isNull);
    expect(pinMenuLabel(isPinned: true, canPin: false), isNull);
  });

  // ── timer ─────────────────────────────────────────────────────────────
  test('timer presets exact labels and helpers', () {
    expect(
      timerOptions.map((o) => [o.seconds, o.label]).toList(),
      [
        [0, 'Off'],
        [86400, '24 hours'],
        [604800, '7 days'],
        [2592000, '30 days'],
      ],
    );
    expect(timerLabelFor(86400), '24 hours');
    expect(timerLabelFor(0), 'Off');
    expect(timerLabelFor(12345), 'Off');
    for (final s in const <int>[0, 86400, 604800, 2592000]) {
      expect(isPresetSeconds(s), isTrue);
    }
    for (final s in const <int>[300, -1, 86401]) {
      expect(isPresetSeconds(s), isFalse);
    }
    expect(embedsExpiry(0), isFalse);
    expect(embedsExpiry(86400), isTrue);
  });

  test('timerSecondsOf reads groups and dm map', () {
    final group = GroupInfo(
      groupId: 'grp-1',
      name: 'Team',
      members: const <GroupMember>[],
      createdBy: 'alice',
      createdAt: 1,
      disappearing: 604800,
    );
    final targetDm = ConversationTarget.dm('bob');
    final targetGroup = ConversationTarget.group('grp-1');
    final missingGroup = ConversationTarget.group('nope');
    expect(timerSecondsOf(const <GroupInfo>[], const <String, int>{}, targetDm), 0);
    expect(
        timerSecondsOf(const <GroupInfo>[], const <String, int>{'dm:bob': 86400}, targetDm),
        86400);
    expect(timerSecondsOf(<GroupInfo>[group], const <String, int>{}, targetGroup), 604800);
    expect(timerSecondsOf(<GroupInfo>[group], const <String, int>{}, missingGroup), 0);
  });

  // ── group_meta ────────────────────────────────────────────────────────
  test('group_meta validation rules', () {
    expect(isValidGroupName(''), isFalse);
    expect(isValidGroupName('   '), isFalse);
    expect(isValidGroupName('Team'), isTrue);
    expect(isValidGroupName('a' * 50), isTrue);
    expect(isValidGroupName('a' * 51), isFalse);
    expect(isValidGroupName('  Team  '), isTrue);
    expect(isValidGroupDescription(''), isTrue);
    expect(isValidGroupDescription('x' * 256), isTrue);
    expect(isValidGroupDescription('x' * 257), isFalse);
    expect(canSaveGroupEdit('Team', ''), isTrue);
    expect(canSaveGroupEdit('', 'desc'), isFalse);
    expect(canSaveGroupEdit('Team', 'x' * 257), isFalse);
    expect(canCreateGroup('Team', ''), isTrue);
    expect(canCreateGroup('', ''), isFalse);
  });

  test('applyGroupUpdated applies and ignores unknown', () {
    final group = GroupInfo(
      groupId: 'grp-1',
      name: 'Team',
      members: const <GroupMember>[
        GroupMember(userId: 'u1', username: 'alice', isAdmin: true),
      ],
      createdBy: 'alice',
      createdAt: 1,
      description: '',
      disappearing: 0,
    );
    final update = GroupUpdatedPayload(
      groupId: 'grp-1',
      name: 'Renamed',
      description: 'Now with notes',
      u: 'alice',
      timestamp: 1,
    );
    final next = applyGroupUpdated(<GroupInfo>[group], update);
    expect(next[0].name, 'Renamed');
    expect(next[0].description, 'Now with notes');
    expect(next[0].disappearing, 0);
    final input = <GroupInfo>[group];
    final unknown = applyGroupUpdated(input, GroupUpdatedPayload(
      groupId: 'ghost',
      name: 'Nope',
      description: 'Nope',
      u: 'alice',
      timestamp: 2,
    ));
    expect(identical(unknown, input), isTrue);
  });

  test('isAdminOf helper', () {
    final group = GroupInfo(
      groupId: 'grp-1',
      name: 'Team',
      members: const <GroupMember>[
        GroupMember(userId: 'u1', username: 'alice', isAdmin: true),
        GroupMember(userId: 'u2', username: 'bob', isAdmin: false),
      ],
      createdBy: 'alice',
      createdAt: 1,
    );
    expect(isAdminOf(<GroupInfo>[group], 'alice', ConversationTarget.group('grp-1')), isTrue);
    expect(isAdminOf(<GroupInfo>[group], 'bob', ConversationTarget.group('grp-1')), isFalse);
    expect(isAdminOf(<GroupInfo>[group], 'me', ConversationTarget.dm('bob')), isTrue);
    expect(isAdminOf(<GroupInfo>[group], null, ConversationTarget.group('grp-1')), isFalse);
  });

  // ── conversation_keys ─────────────────────────────────────────────────
  test('conversation keys and relayKeyFor', () {
    final dmTarget = ConversationTarget.dm('bob');
    final groupTarget = ConversationTarget.group('grp-1');
    expect(conversationKeyFor(dmTarget), 'dm:bob');
    expect(conversationKeyFor(groupTarget), 'group:grp-1');
    final ownMsg = DecryptedMessage(
      id: 'm1',
      from: 'u-me',
      fromUsername: 'me',
      to: 'u-bob',
      toUsername: 'bob',
      plaintext: '{}',
      body: 'hi',
      reply: null,
      edited: false,
      deleted: false,
      timestamp: 1,
      isOwn: true,
      decryptionFailed: false,
      media: null,
      poll: null,
    );
    final inMsg = DecryptedMessage(
      id: 'm2',
      from: 'u-alice',
      fromUsername: 'alice',
      to: 'u-me',
      toUsername: 'me',
      plaintext: '{}',
      body: 'hi',
      reply: null,
      edited: false,
      deleted: false,
      timestamp: 1,
      isOwn: false,
      decryptionFailed: false,
      media: null,
      poll: null,
    );
    expect(conversationKeyOfMessage(ownMsg), 'dm:bob');
    expect(conversationKeyOfMessage(inMsg), 'dm:alice');
    final groupMsg = DecryptedGroupMessage(
      id: 'g1',
      groupId: 'grp-1',
      from: 'u-alice',
      fromUsername: 'alice',
      plaintext: '{}',
      body: 'hi',
      reply: null,
      edited: false,
      deleted: false,
      timestamp: 1,
      isOwn: false,
      decryptionFailed: false,
      media: null,
      poll: null,
    );
    expect(conversationKeyOfMessage(groupMsg), 'group:grp-1');
    expect(relayKeyFor(groupId: 'grp-1', u: 'alice', myUsername: 'me'), 'group:grp-1');
    expect(relayKeyFor(u: 'alice', to: 'bob', myUsername: 'bob'), 'dm:alice');
    expect(relayKeyFor(u: 'bob', to: 'alice', myUsername: 'bob'), 'dm:alice');
    expect(relayKeyFor(myUsername: 'bob'), isNull);
  });

  test('purgeExpired removes expired and recomputes unread + pins', () {
    const now = 1700000000000;
    final live = DecryptedMessage(
      id: 'live',
      from: 'u-alice',
      fromUsername: 'alice',
      to: 'u-me',
      toUsername: 'me',
      plaintext: '{}',
      body: 'hi',
      reply: null,
      edited: false,
      deleted: false,
      timestamp: now - 10000,
      isOwn: false,
      decryptionFailed: false,
      media: null,
      poll: null,
      expiresAt: now + 60000,
    );
    final expired = DecryptedMessage(
      id: 'expired',
      from: 'u-alice',
      fromUsername: 'alice',
      to: 'u-me',
      toUsername: 'me',
      plaintext: '{}',
      body: 'hi',
      reply: null,
      edited: false,
      deleted: false,
      timestamp: now - 10000,
      isOwn: false,
      decryptionFailed: false,
      media: null,
      poll: null,
      expiresAt: now - 1,
    );
    final state = PurgableState(
      messages: <DecryptedMessage>[expired, live],
      groupMessages: const <DecryptedGroupMessage>[],
      unread: <String, UnreadEntry>{'dm:alice': const UnreadEntry(count: 2, mention: true)},
      pins: <String, String>{'dm:me': 'expired'},
    );
    final next = purgeExpired(state, now);
    expect(next.messages.map((m) => m.id).toList(), ['live']);
    expect(next.unread['dm:alice']?.count, 1);
    expect(next.unread['dm:alice']?.mention, isTrue);
    expect(next.pins.containsKey('dm:me'), isFalse);
  });
}
