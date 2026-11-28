import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:scattered_keyhole/src/state/audio_settings.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues(<String, Object>{}));

  test('defaults match the web lane', () {
    expect(AudioSettings.defaults.bitrate, AudioBitrate.voice);
    expect(AudioSettings.defaults.echoCancellation, isTrue);
    expect(AudioSettings.defaults.noiseSuppression, isTrue);
    expect(AudioSettings.defaults.autoGainControl, isTrue);
    expect(AudioSettings.defaults.inputDeviceId, isNull);
    expect(AudioSettings.defaults.outputDeviceId, isNull);
    expect(AudioSettings.defaults.pttKey, '');
    expect(AudioSettings.defaults.ptmKey, '');
  });

  test('load returns defaults when nothing is stored', () async {
    final settings = await AudioSettingsStore.load();
    expect(settings, AudioSettings.defaults);
  });

  test('save/load round-trips every field', () async {
    const input = AudioSettings(
      bitrate: AudioBitrate.music,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      inputDeviceId: 'mic-1',
      outputDeviceId: 'spk-1',
      pttKey: 'Space',
      ptmKey: 'KeyM',
    );
    await AudioSettingsStore.save(input);
    final loaded = await AudioSettingsStore.load();
    expect(loaded, input);
  });

  test('corrupt JSON falls back to defaults', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{'audio_settings': '{not json'});
    final settings = await AudioSettingsStore.load();
    expect(settings, AudioSettings.defaults);
  });

  test('wrong version falls back to defaults', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'audio_settings': '{"v":999,"bitrate":"music"}',
    });
    final settings = await AudioSettingsStore.load();
    expect(settings, AudioSettings.defaults);
  });

  test('buildAudioConstraints includes deviceId only when set', () {
    final none = buildAudioConstraints(AudioSettings.defaults);
    expect(none.containsKey('deviceId'), isFalse);
    expect(none['echoCancellation'], isTrue);

    final withDevice = buildAudioConstraints(
      AudioSettings.defaults.copyWith(inputDeviceId: 'mic-1'),
    );
    expect(withDevice['deviceId'], <String, dynamic>{'exact': 'mic-1'});
  });

  test('audioEncodingFor maps bitrate to bps', () {
    expect(audioEncodingFor(AudioBitrate.voice)['maxBitrate'], 32000);
    expect(audioEncodingFor(AudioBitrate.music)['maxBitrate'], 128000);
  });

  test('isDuplicateKeyBinding and sanitize drop duplicates', () {
    expect(isDuplicateKeyBinding('Space', 'Space'), isTrue);
    expect(isDuplicateKeyBinding('Space', ''), isFalse);
    final dup = sanitizeAudioSettings(
      AudioSettings.defaults.copyWith(pttKey: 'Space', ptmKey: 'Space'),
    );
    expect(dup.pttKey, '');
    expect(dup.ptmKey, '');
  });

  test('formatKeyCode renders common keys', () {
    expect(formatKeyCode(''), 'Unbound');
    expect(formatKeyCode('Space'), 'Space');
    expect(formatKeyCode('KeyM'), 'M');
    expect(formatKeyCode('Digit3'), '3');
  });
}
