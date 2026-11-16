// Poll envelope parsing and validation (spec B1), `wrapPollEnvelope`,
// reply excerpts for polls (B4) and the MediaDescriptor `d` voice-duration
// field (B2).

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:scattered_keyhole/src/models/media.dart';
import 'package:scattered_keyhole/src/utils/envelope.dart';

void main() {
  group('poll envelope parsing (B1)', () {
    test('a valid poll parses to isPoll with question and options', () {
      final parsed = parseEnvelope(
        jsonEncode(<String, dynamic>{
          't': 'poll',
          'q': 'Lunch?',
          'o': <String>['Pizza', 'Sushi'],
        }),
      );
      expect(parsed.isPoll, isTrue);
      expect(parsed.isRaw, isFalse);
      expect(parsed.isText, isFalse);
      expect(parsed.isMedia, isFalse);
      expect(parsed.poll!.question, 'Lunch?');
      expect(parsed.poll!.options, <String>['Pizza', 'Sushi']);
    });

    test('an empty question falls back to raw', () {
      final parsed = parseEnvelope(
        jsonEncode(<String, dynamic>{
          't': 'poll',
          'q': '',
          'o': <String>['A', 'B'],
        }),
      );
      expect(parsed.isPoll, isFalse);
      expect(parsed.raw, isNotNull);
    });

    test('a 201-character question falls back to raw', () {
      final parsed = parseEnvelope(
        jsonEncode(<String, dynamic>{
          't': 'poll',
          'q': 'x' * 201,
          'o': <String>['A', 'B'],
        }),
      );
      expect(parsed.isPoll, isFalse);
      expect(parsed.raw, isNotNull);
    });

    test('option counts outside 2..10 fall back to raw', () {
      for (final options in <List<String>>[
        <String>['Only'],
        <String>['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'],
      ]) {
        final parsed = parseEnvelope(
          jsonEncode(<String, dynamic>{'t': 'poll', 'q': 'Q', 'o': options}),
        );
        expect(parsed.isPoll, isFalse, reason: '${options.length} options');
        expect(parsed.raw, isNotNull);
      }
    });

    test('a 61-character option falls back to raw', () {
      final parsed = parseEnvelope(
        jsonEncode(<String, dynamic>{
          't': 'poll',
          'q': 'Q',
          'o': <String>['x' * 61, 'ok'],
        }),
      );
      expect(parsed.isPoll, isFalse);
      expect(parsed.raw, isNotNull);
    });

    test('duplicate options fall back to raw', () {
      final parsed = parseEnvelope(
        jsonEncode(<String, dynamic>{
          't': 'poll',
          'q': 'Q',
          'o': <String>['same', 'same'],
        }),
      );
      expect(parsed.isPoll, isFalse);
      expect(parsed.raw, isNotNull);
    });

    test('a non-string question falls back to raw', () {
      final parsed = parseEnvelope(
        jsonEncode(<String, dynamic>{
          't': 'poll',
          'q': 42,
          'o': <String>['A', 'B'],
        }),
      );
      expect(parsed.isPoll, isFalse);
      expect(parsed.raw, isNotNull);
    });

    test('a poll without options falls back to raw', () {
      final parsed = parseEnvelope(
        jsonEncode(<String, dynamic>{'t': 'poll', 'q': 'Q'}),
      );
      expect(parsed.isPoll, isFalse);
      expect(parsed.raw, isNotNull);
    });
  });

  group('wrapPollEnvelope (B1)', () {
    test('round-trips a valid definition through parseEnvelope', () {
      final envelope = wrapPollEnvelope(
        'Best day?',
        <String>['Friday', 'Saturday'],
      );
      expect(envelope, isNotNull);
      final decoded = jsonDecode(envelope!) as Map<String, dynamic>;
      expect(decoded['t'], 'poll');
      expect(decoded['q'], 'Best day?');
      expect(decoded['o'], <String>['Friday', 'Saturday']);

      final parsed = parseEnvelope(envelope);
      expect(parsed.poll!.question, 'Best day?');
      expect(parsed.poll!.options, hasLength(2));
    });

    test('returns null for definitions the receiver would reject', () {
      expect(wrapPollEnvelope('Q', <String>['Only']), isNull);
      expect(wrapPollEnvelope('', <String>['A', 'B']), isNull);
      expect(
        wrapPollEnvelope('Q', <String>['dup', 'dup']),
        isNull,
      );
    });
  });

  group('reply excerpts (B4)', () {
    test('poll targets excerpt the question', () {
      final parsed = parseEnvelope(
        jsonEncode(<String, dynamic>{
          't': 'poll',
          'q': 'Lunch?',
          'o': <String>['Pizza', 'Sushi'],
        }),
      );
      expect(
        replyExcerptFor('ignored body', poll: parsed.poll),
        'Lunch?',
      );
    });

    test('long poll questions truncate to 140 chars', () {
      final parsed = parseEnvelope(
        jsonEncode(<String, dynamic>{
          't': 'poll',
          'q': 'y' * 200,
          'o': <String>['A', 'B'],
        }),
      );
      final excerpt = replyExcerptFor('body', poll: parsed.poll);
      expect(excerpt, hasLength(140));
    });

    test('a media name still wins over the poll excerpt', () {
      final parsed = parseEnvelope(
        jsonEncode(<String, dynamic>{
          't': 'poll',
          'q': 'Lunch?',
          'o': <String>['A', 'B'],
        }),
      );
      expect(
        replyExcerptFor('body', mediaName: 'clip.mp4', poll: parsed.poll),
        'clip.mp4',
      );
    });
  });

  group('media duration d (B2)', () {
    MediaDescriptor descriptorWith(Object? duration) {
      final fields = <String, dynamic>{
        't': 'media',
        'v': 1,
        'fileId': '00000000-0000-4000-8000-000000000001',
        'key': base64Encode(List<int>.filled(32, 1)),
        'iv': base64Encode(List<int>.filled(12, 2)),
        'sha256': base64Encode(List<int>.filled(32, 3)),
        'mime': 'audio/mp4',
        'size': 100,
        'd': ?duration,
      };
      final parsed = MediaDescriptor.tryParse(jsonEncode(fields));
      expect(parsed, isNotNull, reason: 'd never rejects the message');
      return parsed!;
    }

    test('an in-range duration is kept as a double', () {
      expect(descriptorWith(7.5).d, 7.5);
      expect(descriptorWith(300).d, 300.0);
      expect(descriptorWith(1).d, 1.0);
    });

    test('out-of-range and malformed durations drop the field', () {
      expect(descriptorWith(0).d, isNull);
      expect(descriptorWith(-3).d, isNull);
      expect(descriptorWith(301).d, isNull);
      expect(descriptorWith('7').d, isNull);
      expect(descriptorWith(true).d, isNull);
    });

    test('a missing d leaves the descriptor valid', () {
      expect(descriptorWith(null).d, isNull);
    });
  });
}
