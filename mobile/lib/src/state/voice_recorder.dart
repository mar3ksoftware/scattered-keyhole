import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

/// Lifecycle of the composer's voice recorder (spec H):
/// idle → recording → sending → sent, with cancelled / permissionDenied
/// as the refusal branches.
enum VoiceRecorderStatus { idle, recording, sending, sent, cancelled, permissionDenied }

/// Spec D permission failure text (mirrors the web recorder).
const String kVoicePermissionError =
    'Microphone access denied. Please allow microphone access and try again.';

/// Spec D send-failure text (mirrors the web composer).
const String kVoiceSendError = 'Message not sent. Please try again.';

/// Platform seam so tests can drive the state machine without a microphone.
abstract interface class VoiceRecorderEngine {
  /// Whether the microphone may be used; false triggers the spec-D error.
  Future<bool> ensurePermission();

  /// A fresh temp path for the recording (`.m4a`).
  Future<String> preparePath();

  /// Starts capturing audio into [path].
  Future<void> start(String path);

  /// Stops capturing, keeping the file at the prepared path.
  Future<void> stop();

  /// Stops capturing and discards the file.
  Future<void> cancel();
}

/// Real engine backed by `record` (spec H frozen config): AAC-LC, mono,
/// 64 kbps, 44.1 kHz into a temp `*.m4a` file.
class RecordVoiceEngine implements VoiceRecorderEngine {
  final AudioRecorder _recorder = AudioRecorder();

  @override
  Future<bool> ensurePermission() async {
    // Desktop platforms have no runtime mic permission to ask for.
    if (!Platform.isAndroid) return true;
    return _recorder.hasPermission();
  }

  @override
  Future<String> preparePath() async {
    final directory = await getTemporaryDirectory();
    final stamp = DateTime.now().millisecondsSinceEpoch;
    return '${directory.path}/voice_$stamp.m4a';
  }

  @override
  Future<void> start(String path) {
    return _recorder.start(
      const RecordConfig(
        encoder: AudioEncoder.aacLc,
        bitRate: 64000,
        sampleRate: 44100,
        numChannels: 1,
      ),
      path: path,
    );
  }

  @override
  Future<void> stop() async {
    await _recorder.stop();
  }

  @override
  Future<void> cancel() async {
    await _recorder.cancel();
  }
}

/// Owns one recording session: elapsed-time ticks, the 300 s auto-stop,
/// and the send/cancel transitions. The engine is created lazily on the
/// first [start] so widget tests never touch a platform channel.
class VoiceRecorderController extends ChangeNotifier {
  VoiceRecorderController({
    required this.onSend,
    VoiceRecorderEngine Function()? engineFactory,
    this.maxDuration = const Duration(seconds: 300),
    this.tickInterval = const Duration(milliseconds: 250),
  }) : _engineFactory = engineFactory ?? RecordVoiceEngine.new;

  /// Uploads the stopped recording; returns false when it did not go out.
  final Future<bool> Function(String path, Duration duration) onSend;

  final VoiceRecorderEngine Function() _engineFactory;

  /// Hard cap per spec H (web `MAX_VOICE_SECONDS`): auto-stop sends at it.
  final Duration maxDuration;

  /// Elapsed-time refresh cadence while recording.
  final Duration tickInterval;

  VoiceRecorderStatus _status = VoiceRecorderStatus.idle;
  Duration _elapsed = Duration.zero;
  String? _error;
  String? _path;
  DateTime? _startedAt;
  Timer? _ticker;
  VoiceRecorderEngine? _engine;
  bool _disposed = false;

  VoiceRecorderStatus get status => _status;
  Duration get elapsed => _elapsed;
  String? get error => _error;
  bool get isRecording => _status == VoiceRecorderStatus.recording;

  /// Starts a new recording after the permission gate (spec H).
  Future<void> start() async {
    if (_status == VoiceRecorderStatus.recording ||
        _status == VoiceRecorderStatus.sending) {
      return;
    }
    _error = null;
    final engine = _engineFactory();
    _engine = engine;
    final granted = await engine.ensurePermission();
    if (_disposed) return;
    if (!granted) {
      _status = VoiceRecorderStatus.permissionDenied;
      _error = kVoicePermissionError;
      _notify();
      return;
    }
    final path = await engine.preparePath();
    if (_disposed) return;
    await engine.start(path);
    if (_disposed) return;
    _path = path;
    _startedAt = DateTime.now();
    _elapsed = Duration.zero;
    _status = VoiceRecorderStatus.recording;
    _startTicker();
    _notify();
  }

  /// Stops the recording and hands it to [VoiceRecorderController.onSend];
  /// a failed upload surfaces the spec-D error and drops the temp file.
  Future<void> send() async {
    if (_status != VoiceRecorderStatus.recording) return;
    _stopTicker();
    _status = VoiceRecorderStatus.sending;
    _error = null;
    _notify();

    final engine = _engine;
    final path = _path;
    final startedAt = _startedAt;
    await engine?.stop();
    final duration = startedAt == null
        ? Duration.zero
        : _clamp(DateTime.now().difference(startedAt));
    if (_disposed) return;
    // Nothing usable: mirror the web recorder and send nothing.
    if (path == null || duration <= Duration.zero) {
      await _deleteFile(path);
      _reset();
      return;
    }

    var sent = false;
    try {
      sent = await onSend(path, duration);
    } catch (_) {
      sent = false;
    }
    await _deleteFile(path);
    if (_disposed) return;
    if (sent) {
      _status = VoiceRecorderStatus.sent;
      _path = null;
      _notify();
    } else {
      _error = kVoiceSendError;
      _reset();
    }
  }

  /// Discards the in-progress recording (spec H: `cancel()` + delete file).
  Future<void> cancel() async {
    if (_status != VoiceRecorderStatus.recording) return;
    _stopTicker();
    _status = VoiceRecorderStatus.cancelled;
    _notify();
    final engine = _engine;
    final path = _path;
    await engine?.cancel();
    await _deleteFile(path);
    if (_disposed) return;
    _reset();
  }

  Duration _clamp(Duration value) {
    if (value < Duration.zero) return Duration.zero;
    return value > maxDuration ? maxDuration : value;
  }

  void _startTicker() {
    _ticker = Timer.periodic(tickInterval, (_) {
      if (_disposed || _status != VoiceRecorderStatus.recording) return;
      final startedAt = _startedAt;
      if (startedAt == null) return;
      final elapsed = _clamp(DateTime.now().difference(startedAt));
      _elapsed = elapsed;
      _notify();
      if (elapsed >= maxDuration) {
        // Spec H: the 300 s cap auto-stops and sends, like the web client.
        unawaited(send());
      }
    });
  }

  void _stopTicker() {
    _ticker?.cancel();
    _ticker = null;
  }

  void _reset() {
    _status = VoiceRecorderStatus.idle;
    _elapsed = Duration.zero;
    _path = null;
    _startedAt = null;
    _engine = null;
    _notify();
  }

  Future<void> _deleteFile(String? path) async {
    if (path == null) return;
    try {
      final file = File(path);
      if (await file.exists()) await file.delete();
    } catch (_) {
      // Temp-dir cleanup failures never surface to the user.
    }
  }

  void _notify() {
    if (_disposed) return;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _stopTicker();
    // Unmounting mid-recording releases the mic without sending (web parity).
    final engine = _engine;
    final path = _path;
    _engine = null;
    _path = null;
    if (engine != null && _status == VoiceRecorderStatus.recording) {
      unawaited(engine.cancel());
      unawaited(_deleteFile(path));
    }
    super.dispose();
  }
}
