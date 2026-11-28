// ── Audio settings (roadmap 8c) ───────────────────────────────────────
// Preferences only — no messages, keys or conversation state live here, so
// the "no chat data in storage" rule is untouched.

import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

enum AudioBitrate { voice, music }

extension AudioBitrateX on AudioBitrate {
  String get wireValue => this == AudioBitrate.music ? 'music' : 'voice';
  static AudioBitrate fromWire(Object? value) =>
      value == 'music' ? AudioBitrate.music : AudioBitrate.voice;
}

class AudioSettings {
  const AudioSettings({
    this.bitrate = AudioBitrate.voice,
    this.echoCancellation = true,
    this.noiseSuppression = true,
    this.autoGainControl = true,
    this.inputDeviceId,
    this.outputDeviceId,
    this.pttKey = '',
    this.ptmKey = '',
  });

  final AudioBitrate bitrate;
  final bool echoCancellation;
  final bool noiseSuppression;
  final bool autoGainControl;
  final String? inputDeviceId;
  final String? outputDeviceId;
  // `event.code`-style label, empty string = unbound.
  final String pttKey;
  final String ptmKey;

  static const AudioSettings defaults = AudioSettings();

  factory AudioSettings.fromJson(Map<String, dynamic> json) {
    return AudioSettings(
      bitrate: AudioBitrateX.fromWire(json['bitrate']),
      echoCancellation: json['echoCancellation'] is bool
          ? json['echoCancellation'] as bool
          : true,
      noiseSuppression: json['noiseSuppression'] is bool
          ? json['noiseSuppression'] as bool
          : true,
      autoGainControl: json['autoGainControl'] is bool
          ? json['autoGainControl'] as bool
          : true,
      inputDeviceId: json['inputDeviceId'] is String &&
              (json['inputDeviceId'] as String).isNotEmpty
          ? json['inputDeviceId'] as String
          : null,
      outputDeviceId: json['outputDeviceId'] is String &&
              (json['outputDeviceId'] as String).isNotEmpty
          ? json['outputDeviceId'] as String
          : null,
      pttKey: json['pttKey'] is String ? json['pttKey'] as String : '',
      ptmKey: json['ptmKey'] is String ? json['ptmKey'] as String : '',
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'bitrate': bitrate.wireValue,
        'echoCancellation': echoCancellation,
        'noiseSuppression': noiseSuppression,
        'autoGainControl': autoGainControl,
        'inputDeviceId': inputDeviceId,
        'outputDeviceId': outputDeviceId,
        'pttKey': pttKey,
        'ptmKey': ptmKey,
      };

  AudioSettings copyWith({
    AudioBitrate? bitrate,
    bool? echoCancellation,
    bool? noiseSuppression,
    bool? autoGainControl,
    String? inputDeviceId,
    bool clearInput = false,
    String? outputDeviceId,
    bool clearOutput = false,
    String? pttKey,
    String? ptmKey,
  }) {
    return AudioSettings(
      bitrate: bitrate ?? this.bitrate,
      echoCancellation: echoCancellation ?? this.echoCancellation,
      noiseSuppression: noiseSuppression ?? this.noiseSuppression,
      autoGainControl: autoGainControl ?? this.autoGainControl,
      inputDeviceId: clearInput ? null : (inputDeviceId ?? this.inputDeviceId),
      outputDeviceId: clearOutput ? null : (outputDeviceId ?? this.outputDeviceId),
      pttKey: pttKey ?? this.pttKey,
      ptmKey: ptmKey ?? this.ptmKey,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is AudioSettings &&
      other.bitrate == bitrate &&
      other.echoCancellation == echoCancellation &&
      other.noiseSuppression == noiseSuppression &&
      other.autoGainControl == autoGainControl &&
      other.inputDeviceId == inputDeviceId &&
      other.outputDeviceId == outputDeviceId &&
      other.pttKey == pttKey &&
      other.ptmKey == ptmKey;

  @override
  int get hashCode => Object.hash(
        bitrate,
        echoCancellation,
        noiseSuppression,
        autoGainControl,
        inputDeviceId,
        outputDeviceId,
        pttKey,
        ptmKey,
      );
}

abstract final class AudioSettingsStore {
  static const String prefKey = 'audio_settings';

  static Future<AudioSettings> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(prefKey);
    if (raw == null || raw.isEmpty) return AudioSettings.defaults;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return AudioSettings.defaults;
      final map = Map<String, dynamic>.from(decoded);
      if (map['v'] != 1) return AudioSettings.defaults;
      return sanitizeAudioSettings(AudioSettings.fromJson(map));
    } catch (_) {
      return AudioSettings.defaults;
    }
  }

  static Future<void> save(AudioSettings settings) async {
    final prefs = await SharedPreferences.getInstance();
    final payload = <String, dynamic>{'v': 1, ...settings.toJson()};
    await prefs.setString(prefKey, jsonEncode(payload));
  }
}

// Duplicate bindings are dropped to unbound: a single key cannot be both
// push-to-talk and push-to-mute.
bool isDuplicateKeyBinding(String pttKey, String ptmKey) =>
    pttKey.isNotEmpty && pttKey == ptmKey;

AudioSettings sanitizeAudioSettings(AudioSettings input) {
  final pttKey = input.pttKey;
  final ptmKey = input.ptmKey;
  final duplicate = isDuplicateKeyBinding(pttKey, ptmKey);
  return input.copyWith(
    pttKey: duplicate ? '' : pttKey,
    ptmKey: duplicate ? '' : ptmKey,
  );
}

// getUserMedia audio constraints: exact device when set, plus the 3 DSP
// switches.
Map<String, dynamic> buildAudioConstraints(AudioSettings settings) => <String, dynamic>{
      if (settings.inputDeviceId != null)
        'deviceId': <String, dynamic>{'exact': settings.inputDeviceId},
      'echoCancellation': settings.echoCancellation,
      'noiseSuppression': settings.noiseSuppression,
      'autoGainControl': settings.autoGainControl,
      'channelCount': <String, dynamic>{
        'ideal': settings.bitrate == AudioBitrate.music ? 2 : 1,
      },
    };

// Opus bitrate ceiling on the live transport.
Map<String, dynamic> audioEncodingFor(AudioBitrate bitrate) => <String, dynamic>{
      'maxBitrate': bitrate == AudioBitrate.music ? 128000 : 32000,
    };

// Output device selection: feature-detect setSinkId-equivalent. Mobile has no
// equivalent, so this is a documented no-op on that platform.
String formatKeyCode(String code) {
  if (code.isEmpty) return 'Unbound';
  const named = <String, String>{
    'Space': 'Space',
    'Escape': 'Esc',
    'Tab': 'Tab',
    'Enter': 'Enter',
    'Backquote': '`',
    'Minus': '-',
    'Equal': '=',
    'BracketLeft': '[',
    'BracketRight': ']',
    'Backslash': '\\',
    'Semicolon': ';',
    'Quote': "'",
    'Comma': ',',
    'Period': '.',
    'Slash': '/',
    'ArrowUp': 'Up arrow',
    'ArrowDown': 'Down arrow',
    'ArrowLeft': 'Left arrow',
    'ArrowRight': 'Right arrow',
    'ShiftLeft': 'Left Shift',
    'ShiftRight': 'Right Shift',
    'ControlLeft': 'Left Ctrl',
    'ControlRight': 'Right Ctrl',
    'AltLeft': 'Left Alt',
    'AltRight': 'Right Alt',
    'MetaLeft': 'Left Meta',
    'MetaRight': 'Right Meta',
    'CapsLock': 'Caps Lock',
  };
  final label = named[code];
  if (label != null) return label;
  if (code.startsWith('Key')) return code.substring(3);
  if (code.startsWith('Digit')) return code.substring(5);
  if (code.startsWith('Numpad')) return 'Num ${code.substring(6)}';
  if (code.startsWith('F') && RegExp(r'^F\d{1,2}$').hasMatch(code)) return code;
  return code;
}
