// Poll UI (spec C1/C3/C4): the composer panel's validation gates, the
// PollBubble rows/highlight/close footer, the audio-vs-image attachment
// dispatch with the `m:ss / m:ss` time text (D/H), and the
// VoiceRecorderController state machine behind a fake engine (H).

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scattered_keyhole/src/crypto/e2ee_session.dart';
import 'package:scattered_keyhole/src/models/models.dart';
import 'package:scattered_keyhole/src/net/chat_events.dart';
import 'package:scattered_keyhole/src/net/media_client.dart';
import 'package:scattered_keyhole/src/state/chat_controller.dart';
import 'package:scattered_keyhole/src/state/voice_recorder.dart';
import 'package:scattered_keyhole/src/ui/theme/app_theme.dart';
import 'package:scattered_keyhole/src/ui/widgets/message_bubble.dart';
import 'package:scattered_keyhole/src/ui/widgets/message_composer.dart';
import 'package:scattered_keyhole/src/ui/widgets/poll_bubble.dart';
import 'package:scattered_keyhole/src/utils/envelope.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'ui_test_support.dart';

/// Pumps until [condition] holds — the widget-test counterpart of the
/// plain tests' `waitFor` (fake time only advances when we pump).
Future<void> pumpUntil(
  WidgetTester tester,
  bool Function() condition, {
  int maxPumps = 50,
}) async {
  for (var i = 0; i < maxPumps && !condition(); i++) {
    await tester.pump();
  }
  if (!condition()) fail('Condition never became true');
}

const PollDefinition lunchPoll = PollDefinition(
  question: 'Lunch?',
  options: <String>['Pizza', 'Sushi'],
);

/// Controller stand-in that serves a fixed fetch result without touching
/// the network or the decrypt pipeline (same shape as ui_media_test).
class StubMediaController extends ChatController {
  StubMediaController(this.stubbedResult)
    : super(
        socket: FakeSocketService(),
        errorClearDelay: const Duration(days: 1),
      );

  final MediaFetchResult stubbedResult;

  @override
  Future<MediaFetchResult> loadMedia(MediaDescriptor descriptor) async {
    return stubbedResult;
  }
}

/// In-memory [VoiceRecorderEngine]: records every call and never touches
/// a platform channel (spec H's seam).
class FakeVoiceEngine implements VoiceRecorderEngine {
  bool grantPermission = true;
  final List<String> calls = <String>[];

  @override
  Future<bool> ensurePermission() async {
    calls.add('permission');
    return grantPermission;
  }

  @override
  Future<String> preparePath() async {
    calls.add('prepare');
    return '/tmp/voice_poll_test.m4a';
  }

  @override
  Future<void> start(String path) async {
    calls.add('start:$path');
  }

  @override
  Future<void> stop() async {
    calls.add('stop');
  }

  @override
  Future<void> cancel() async {
    calls.add('cancel');
  }
}

void main() {
  // E2eeSession persists its identity key via shared_preferences; widget tests
  // run in a fake-async zone where the real plugin channel would never reply,
  // so back it with the in-memory store.
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  // 1×1 red RGBA PNG, the smallest valid image the decoder accepts.
  final Uint8List pngBytes = base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  );

  MediaDescriptor audioDescriptor({double? duration}) => MediaDescriptor(
    fileId: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff',
    key: base64Encode(List<int>.filled(32, 1)),
    iv: base64Encode(List<int>.filled(12, 2)),
    sha256: base64Encode(List<int>.filled(32, 3)),
    mime: 'audio/mp4',
    size: 1024,
    name: 'note.m4a',
    d: duration,
  );

  MediaDescriptor imageDescriptor() => MediaDescriptor(
    fileId: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff',
    key: base64Encode(List<int>.filled(32, 1)),
    iv: base64Encode(List<int>.filled(12, 2)),
    sha256: base64Encode(List<int>.filled(32, 3)),
    mime: 'image/png',
    size: pngBytes.length,
    w: 1,
    h: 1,
    name: 'pixel.png',
  );

  Future<void> pumpAttachment(
    WidgetTester tester,
    StubMediaController controller,
    MediaDescriptor descriptor,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildAppTheme(),
        home: Scaffold(
          body: ListView(
            children: [
              MessageBubble.fromView(
                MessageView(
                  text: '',
                  isOwn: false,
                  timestamp: DateTime(2026, 3, 5, 9, 30).millisecondsSinceEpoch,
                  media: descriptor,
                ),
                controller: controller,
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
  }

  Future<void> pumpComposer(
    WidgetTester tester, {
    Future<bool> Function(String, List<String>)? onSendPoll,
    VoiceRecorderController? voiceRecorder,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildAppTheme(),
        home: Scaffold(
          body: MessageComposer(
            enabled: true,
            onSend: (_) async => true,
            onSendPoll: onSendPoll,
            voiceRecorder: voiceRecorder,
          ),
        ),
      ),
    );
    await tester.pump();
  }

  FilledButton pollSendButton(WidgetTester tester) {
    return tester.widget<FilledButton>(find.byKey(const Key('poll-send')));
  }

  group('spec D format helpers', () {
    test('formatVoteCount pluralises 0 / 1 / N votes', () {
      expect(formatVoteCount(0), '0 votes');
      expect(formatVoteCount(1), '1 vote');
      expect(formatVoteCount(7), '7 votes');
    });

    test('pollPercent rounds like Math.round and is 0 on an empty poll', () {
      expect(pollPercent(0, 0), 0);
      expect(pollPercent(0, 5), 0);
      expect(pollPercent(1, 2), 50);
      expect(pollPercent(1, 3), 33);
      expect(pollPercent(2, 3), 67);
      expect(pollPercent(1, 1), 100);
    });
  });

  group('PollBubble (C3/C4)', () {
    Future<void> pumpBubble(
      WidgetTester tester, {
      required Map<String, int> tallies,
      required bool closed,
      int? myVote,
      required bool canVote,
      required bool canClose,
      void Function(int)? onVote,
      VoidCallback? onClose,
    }) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(),
          home: Scaffold(
            body: ListView(
              children: [
                PollBubble(
                  poll: lunchPoll,
                  tallies: tallies,
                  closed: closed,
                  myVote: myVote,
                  canVote: canVote,
                  canClose: canClose,
                  onVote: onVote,
                  onClose: onClose,
                ),
              ],
            ),
          ),
        ),
      );
      await tester.pump();
    }

    testWidgets('renders the question, every option and the vote count', (
      tester,
    ) async {
      await pumpBubble(
        tester,
        tallies: const <String, int>{'alice': 0},
        closed: false,
        myVote: null,
        canVote: true,
        canClose: false,
      );

      expect(find.text('Lunch?'), findsOneWidget);
      expect(find.text('Pizza'), findsOneWidget);
      expect(find.text('Sushi'), findsOneWidget);
      expect(find.text('0%'), findsOneWidget);
      expect(find.text('100%'), findsOneWidget);
      expect(find.text('1 vote'), findsOneWidget);
      expect(find.text('Poll closed'), findsNothing);
    });

    testWidgets('our vote row is the highlighted one', (tester) async {
      await pumpBubble(
        tester,
        tallies: const <String, int>{'me': 1},
        closed: false,
        myVote: 1,
        canVote: true,
        canClose: false,
      );

      // The chosen row renders its label at w600 while the other stays w400.
      expect(
        tester.widget<Text>(find.text('Sushi')).style!.fontWeight,
        FontWeight.w600,
      );
      expect(
        tester.widget<Text>(find.text('Pizza')).style!.fontWeight,
        FontWeight.w400,
      );
      // …and only its container wears the accent tint.
      final tinted = tester.widgetList<Container>(
        find.ancestor(
          of: find.text('Sushi'),
          matching: find.byType(Container),
        ),
      );
      expect(
        tinted.where(
          (box) =>
              box.decoration is BoxDecoration &&
              (box.decoration as BoxDecoration).color == AppColors.accentTint,
        ),
        hasLength(1),
      );
    });

    testWidgets('the Poll closed footer only shows once closed', (tester) async {
      await pumpBubble(
        tester,
        tallies: const <String, int>{},
        closed: false,
        myVote: null,
        canVote: true,
        canClose: false,
      );
      expect(find.text('Poll closed'), findsNothing);

      await pumpBubble(
        tester,
        tallies: const <String, int>{},
        closed: true,
        myVote: null,
        canVote: false,
        canClose: false,
      );
      expect(find.text('Poll closed'), findsOneWidget);
    });

    testWidgets('the close button only shows for the author', (tester) async {
      var closed = 0;
      await pumpBubble(
        tester,
        tallies: const <String, int>{},
        closed: false,
        myVote: null,
        canVote: true,
        canClose: true,
        onClose: () => closed++,
      );
      expect(find.byKey(const Key('poll-close-button')), findsOneWidget);

      await tester.tap(find.byKey(const Key('poll-close-button')));
      await tester.pump();
      expect(closed, 1);

      await pumpBubble(
        tester,
        tallies: const <String, int>{},
        closed: false,
        myVote: null,
        canVote: true,
        canClose: false,
      );
      expect(find.byKey(const Key('poll-close-button')), findsNothing);
    });

    testWidgets('tapping an option reports its index', (tester) async {
      int? voted;
      await pumpBubble(
        tester,
        tallies: const <String, int>{},
        closed: false,
        myVote: null,
        canVote: true,
        canClose: false,
        onVote: (option) => voted = option,
      );

      await tester.tap(find.text('Sushi'));
      await tester.pump();

      expect(voted, 1);
    });
  });

  group('MessageComposer poll panel (C1)', () {
    testWidgets('send stays disabled until the poll is valid, then submits', (
      tester,
    ) async {
      (String, List<String>)? sent;
      Future<bool> onSendPoll(String question, List<String> options) async {
        sent = (question, options);
        return true;
      }

      await pumpComposer(tester, onSendPoll: onSendPoll);
      await tester.tap(find.byKey(const Key('poll-toggle-button')));
      await tester.pump();

      expect(find.byKey(const Key('poll-panel')), findsOneWidget);
      expect(find.text('Create poll'), findsOneWidget);
      expect(pollSendButton(tester).onPressed, isNull);

      await tester.enterText(
        find.byKey(const Key('poll-question')),
        '  Lunch?  ',
      );
      await tester.enterText(find.byKey(const Key('poll-option-0')), ' Pizza ');
      await tester.enterText(find.byKey(const Key('poll-option-1')), 'Sushi');
      await tester.pump();
      expect(pollSendButton(tester).onPressed, isNotNull);

      await tester.tap(find.byKey(const Key('poll-send')));
      await tester.pumpAndSettle();

      expect(sent, isNotNull);
      expect(sent!.$1, 'Lunch?');
      expect(sent!.$2, <String>['Pizza', 'Sushi']);
      expect(find.byKey(const Key('poll-panel')), findsNothing);
    });

    testWidgets('duplicate options keep send disabled', (tester) async {
      await pumpComposer(tester, onSendPoll: (_, _) async => true);
      await tester.tap(find.byKey(const Key('poll-toggle-button')));
      await tester.pump();

      await tester.enterText(find.byKey(const Key('poll-question')), 'Q');
      await tester.enterText(find.byKey(const Key('poll-option-0')), 'Same');
      await tester.enterText(find.byKey(const Key('poll-option-1')), 'Same');
      await tester.pump();

      expect(pollSendButton(tester).onPressed, isNull);
    });

    testWidgets('cancel closes the panel and clears the fields', (tester) async {
      await pumpComposer(tester, onSendPoll: (_, _) async => true);
      await tester.tap(find.byKey(const Key('poll-toggle-button')));
      await tester.pump();
      await tester.enterText(
        find.byKey(const Key('poll-question')),
        'Lunch?',
      );
      await tester.pump();

      await tester.tap(find.byKey(const Key('poll-cancel')));
      await tester.pump();
      expect(find.byKey(const Key('poll-panel')), findsNothing);

      await tester.tap(find.byKey(const Key('poll-toggle-button')));
      await tester.pump();
      expect(find.text('Lunch?'), findsNothing);
      expect(pollSendButton(tester).onPressed, isNull);
    });

    testWidgets('add and remove option rows follow the 2..10 bounds', (
      tester,
    ) async {
      await pumpComposer(tester, onSendPoll: (_, _) async => true);
      await tester.tap(find.byKey(const Key('poll-toggle-button')));
      await tester.pump();

      // Two options to start: no remove buttons yet.
      expect(find.byKey(const Key('poll-option-2')), findsNothing);
      expect(find.byTooltip('Remove option 1'), findsNothing);

      await tester.tap(find.byKey(const Key('poll-add-option')));
      await tester.pump();
      expect(find.byKey(const Key('poll-option-2')), findsOneWidget);
      expect(find.byTooltip('Remove option 3'), findsOneWidget);

      await tester.tap(find.byTooltip('Remove option 3'));
      await tester.pump();
      expect(find.byKey(const Key('poll-option-2')), findsNothing);
    });

    testWidgets('the panel stays hidden without an onSendPoll handler', (
      tester,
    ) async {
      await pumpComposer(tester, onSendPoll: null);

      expect(find.byKey(const Key('poll-toggle-button')), findsNothing);
    });
  });

  group('attachment dispatch (H)', () {
    testWidgets('an audio mime renders the voice bubble with its time text', (
      tester,
    ) async {
      final controller = StubMediaController(
        MediaFetchResult.ready(Uint8List.fromList(<int>[1, 2, 3])),
      );
      addTearDown(controller.dispose);

      await pumpAttachment(tester, controller, audioDescriptor(duration: 7));

      expect(find.byKey(const Key('voice-play-button')), findsOneWidget);
      expect(find.byKey(const Key('voice-pause-button')), findsNothing);
      // Position starts at 0:00; the total comes from the `d` field (B2).
      expect(find.text('0:00 / 0:07'), findsOneWidget);
      expect(find.byType(Image), findsNothing);
      expect(find.text('Loading…'), findsNothing);
    });

    testWidgets('an image mime still renders an inline image', (tester) async {
      final controller = StubMediaController(MediaFetchResult.ready(pngBytes));
      addTearDown(controller.dispose);

      await pumpAttachment(tester, controller, imageDescriptor());

      expect(find.byType(Image), findsOneWidget);
      expect(find.byKey(const Key('voice-play-button')), findsNothing);
      expect(find.text('Loading…'), findsNothing);
    });
  });

  group('VoiceRecorderController (H)', () {
    VoiceRecorderController makeRecorder(
      FakeVoiceEngine engine, {
      Future<bool> Function(String path, Duration duration)? onSend,
      Duration maxDuration = const Duration(seconds: 300),
      Duration tickInterval = const Duration(milliseconds: 250),
    }) {
      return VoiceRecorderController(
        onSend: onSend ?? (_, _) async => true,
        engineFactory: () => engine,
        maxDuration: maxDuration,
        tickInterval: tickInterval,
      );
    }

    test('start moves idle → recording through the engine seam', () async {
      final engine = FakeVoiceEngine();
      final voice = makeRecorder(engine);
      addTearDown(voice.dispose);
      expect(voice.status, VoiceRecorderStatus.idle);

      await voice.start();

      expect(voice.status, VoiceRecorderStatus.recording);
      expect(voice.isRecording, isTrue);
      expect(voice.elapsed, Duration.zero);
      expect(engine.calls, contains('permission'));
      expect(engine.calls, contains('start:/tmp/voice_poll_test.m4a'));
    });

    test('a denied permission surfaces the spec-D error and never starts', () async {
      final engine = FakeVoiceEngine()..grantPermission = false;
      final voice = makeRecorder(engine);
      addTearDown(voice.dispose);

      await voice.start();

      expect(voice.status, VoiceRecorderStatus.permissionDenied);
      expect(voice.error, kVoicePermissionError);
      expect(engine.calls, contains('permission'));
      expect(
        engine.calls.where((call) => call.startsWith('start:')),
        isEmpty,
      );
    });

    test('send uploads the recording and lands on sent', () async {
      final engine = FakeVoiceEngine();
      String? sentPath;
      Duration? sentDuration;
      final voice = makeRecorder(
        engine,
        onSend: (path, duration) async {
          sentPath = path;
          sentDuration = duration;
          return true;
        },
      );
      addTearDown(voice.dispose);
      await voice.start();
      // Let the clock tick so the recorded duration is non-zero.
      await Future<void>.delayed(const Duration(milliseconds: 25));

      await voice.send();

      expect(voice.status, VoiceRecorderStatus.sent);
      expect(voice.error, isNull);
      expect(sentPath, '/tmp/voice_poll_test.m4a');
      expect(sentDuration, isNotNull);
      expect(sentDuration!.inMilliseconds, greaterThan(0));
      expect(sentDuration!, lessThanOrEqualTo(const Duration(seconds: 300)));
      expect(engine.calls, contains('stop'));
      expect(engine.calls, isNot(contains('cancel')));
    });

    test('a failed upload surfaces the spec-D error and resets', () async {
      final engine = FakeVoiceEngine();
      final voice = makeRecorder(engine, onSend: (_, _) async => false);
      addTearDown(voice.dispose);
      await voice.start();
      await Future<void>.delayed(const Duration(milliseconds: 25));

      await voice.send();

      expect(voice.status, VoiceRecorderStatus.idle);
      expect(voice.error, kVoiceSendError);
      expect(engine.calls, contains('stop'));
    });

    test('cancel discards the recording and resets', () async {
      final engine = FakeVoiceEngine();
      final voice = makeRecorder(engine);
      addTearDown(voice.dispose);
      await voice.start();
      await Future<void>.delayed(const Duration(milliseconds: 25));
      final statuses = <VoiceRecorderStatus>[];
      voice.addListener(() => statuses.add(voice.status));

      await voice.cancel();

      expect(statuses, contains(VoiceRecorderStatus.cancelled));
      expect(voice.status, VoiceRecorderStatus.idle);
      expect(engine.calls, contains('cancel'));
      expect(engine.calls, isNot(contains('stop')));
    });

    test('send while idle is a no-op', () async {
      final engine = FakeVoiceEngine();
      var sends = 0;
      final voice = makeRecorder(
        engine,
        onSend: (_, _) async {
          sends++;
          return true;
        },
      );
      addTearDown(voice.dispose);

      await voice.send();

      expect(sends, 0);
      expect(voice.status, VoiceRecorderStatus.idle);
      expect(engine.calls, isEmpty);
    });

    test('hitting the duration cap auto-stops and sends', () async {
      final engine = FakeVoiceEngine();
      String? sentPath;
      final voice = makeRecorder(
        engine,
        onSend: (path, _) async {
          sentPath = path;
          return true;
        },
        maxDuration: const Duration(milliseconds: 80),
        tickInterval: const Duration(milliseconds: 10),
      );
      addTearDown(voice.dispose);
      await voice.start();
      expect(voice.status, VoiceRecorderStatus.recording);

      final deadline = DateTime.now().add(const Duration(seconds: 3));
      while (voice.status != VoiceRecorderStatus.sent &&
          DateTime.now().isBefore(deadline)) {
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }

      expect(voice.status, VoiceRecorderStatus.sent);
      expect(sentPath, '/tmp/voice_poll_test.m4a');
      expect(engine.calls, contains('stop'));
    });
  });

  group('composer voice bar (H)', () {
    testWidgets('the mic records into the bar and Cancel returns', (
      tester,
    ) async {
      final engine = FakeVoiceEngine();
      final voice = VoiceRecorderController(
        onSend: (_, _) async => true,
        engineFactory: () => engine,
      );
      addTearDown(voice.dispose);
      await pumpComposer(tester, voiceRecorder: voice);
      expect(find.byKey(const Key('voice-record-button')), findsOneWidget);
      expect(find.byKey(const Key('voice-recording-bar')), findsNothing);

      await tester.tap(find.byKey(const Key('voice-record-button')));
      await tester.pump();
      await tester.pump();

      expect(find.byKey(const Key('voice-recording-bar')), findsOneWidget);
      expect(find.byKey(const Key('voice-elapsed')), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const Key('voice-elapsed'))).data,
        '0:00',
      );
      expect(find.byKey(const Key('voice-send')), findsOneWidget);

      await tester.tap(find.byKey(const Key('voice-cancel')));
      // The cancel path deletes the temp file with real IO; let the event
      // loop turn so the completion can be flushed by the next pump.
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
      await tester.pump();

      expect(find.byKey(const Key('voice-recording-bar')), findsNothing);
      expect(find.byKey(const Key('voice-record-button')), findsOneWidget);
      expect(voice.status, VoiceRecorderStatus.idle);
    });
  });

  group('bubble ↔ controller wiring (C3)', () {
    /// Establishes the alice session and lands her `Lunch?` poll as
    /// `poll-1` in the controller — the shared setup for the wired-bubble
    /// tests (fake time only advances when we pump).
    Future<String> landAlicePoll(
      WidgetTester tester,
      FakeSocketService fake,
      ChatController controller,
      E2eeSession alice,
    ) async {
      fake.fire(
        ChatEvents.e2eePublicKey,
        E2eePublicKeyRelay(
          from: 'u-alice',
          fromUsername: 'alice',
          publicKey: await alice.getPublicKey(),
        ),
      );
      await pumpUntil(tester, () => controller.e2ee.hasSharedKey('alice'));
      await alice.deriveSharedSecret(
        'me',
        await controller.e2ee.getPublicKey(),
      );

      final envelope = wrapPollEnvelope(
        'Lunch?',
        <String>['Pizza', 'Sushi'],
      )!;
      final payload = await alice.encrypt('me', envelope);
      fake.fire(
        ChatEvents.privateMessage,
        PrivateMessage(
          id: 'poll-1',
          from: 'u-alice',
          fromUsername: 'alice',
          to: 'u-me',
          toUsername: 'me',
          ciphertext: payload.ciphertext,
          iv: payload.iv,
          timestamp: 700,
        ),
      );
      await pumpUntil(
        tester,
        () => controller
            .messagesForPeer('alice')
            .any((message) => message.id == 'poll-1' && message.poll != null),
      );
      return 'poll-1';
    }

    /// Pumps alice's poll bubble wired to [controller].
    Future<void> pumpAlicePollBubble(
      WidgetTester tester,
      ChatController controller,
    ) async {
      final stored = controller
          .messagesForPeer('alice')
          .firstWhere((message) => message.id == 'poll-1');
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(),
          home: Scaffold(
            body: ListView(
              children: [
                MessageBubble.fromView(
                  MessageView.fromPrivate(stored),
                  controller: controller,
                  target: const ConversationTarget.dm('alice'),
                ),
              ],
            ),
          ),
        ),
      );
      await tester.pump();
    }

    testWidgets('a wired bubble shows tallies and votes through the controller', (
      tester,
    ) async {
      final fake = FakeSocketService();
      final controller = makeController(fake);
      addTearDown(controller.dispose);
      signIn(fake);
      setUsers(fake, const <UserInfo>[meInfo, aliceInfo, bobInfo]);

      final pollId = await landAlicePoll(tester, fake, controller, E2eeSession());
      // Alice's relayed vote fills the tally.
      fake.fire(
        ChatEvents.pollVoted,
        PollVotedPayload(pollId: pollId, option: 0, u: 'alice'),
      );

      await pumpAlicePollBubble(tester, controller);

      expect(find.text('Lunch?'), findsOneWidget);
      expect(find.text('1 vote'), findsOneWidget);
      // Alice's poll: no close button for us.
      expect(find.byKey(const Key('poll-close-button')), findsNothing);

      await tester.tap(find.text('Sushi'));
      await tester.pump();

      expect(fake.countOf(ChatEvents.pollVote), 1);
      final vote =
          fake.payloadsOf(ChatEvents.pollVote).single as PollVotePayload;
      expect(vote.pollId, pollId);
      expect(vote.option, 1);
      expect(vote.to, 'alice');
      expect(controller.pollTalliesFor(pollId), <String, int>{
        'alice': 0,
        'me': 1,
      });
    });

    testWidgets('a closed poll stops voting end to end (C4)', (tester) async {
      final fake = FakeSocketService();
      final controller = makeController(fake);
      addTearDown(controller.dispose);
      signIn(fake);
      setUsers(fake, const <UserInfo>[meInfo, aliceInfo, bobInfo]);

      final pollId = await landAlicePoll(tester, fake, controller, E2eeSession());
      fake.fire(
        ChatEvents.pollClosed,
        PollClosedPayload(pollId: pollId, u: 'alice'),
      );
      await pumpAlicePollBubble(tester, controller);

      expect(find.text('Poll closed'), findsOneWidget);
      // The wiring drops the vote handler once the poll is closed.
      await tester.tap(find.text('Sushi'), warnIfMissed: false);
      await tester.pump();

      expect(fake.countOf(ChatEvents.pollVote), 0);
      expect(controller.pollTalliesFor(pollId), isEmpty);
    });
  });
}
