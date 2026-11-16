import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:media_kit/media_kit.dart';
import 'package:path_provider/path_provider.dart';

import '../../models/models.dart';
import '../../net/media_opener.dart';
import '../../utils/time.dart';
import '../theme/app_theme.dart';

/// Playback seam around `media_kit` so widget tests can drive the voice
/// bubble without loading the native player (spec H).
abstract interface class VoicePlayback {
  Stream<Duration> get position;
  Stream<Duration> get duration;
  Stream<bool> get playing;

  /// Decrypts [bytes] into a temp file and opens it with the player.
  Future<void> open(Uint8List bytes, {String? name});

  Future<void> play();
  Future<void> pause();
  Future<void> dispose();
}

/// Real playback: writes the decrypted bytes to a temp file and plays it
/// through a `media_kit` [Player] (spec H frozen dependencies).
class MediaKitVoicePlayback implements VoicePlayback {
  MediaKitVoicePlayback() : _player = Player();

  final Player _player;
  String? _tempPath;

  @override
  Stream<Duration> get position => _player.stream.position;

  @override
  Stream<Duration> get duration => _player.stream.duration;

  @override
  Stream<bool> get playing => _player.stream.playing;

  @override
  Future<void> open(Uint8List bytes, {String? name}) async {
    final directory = await getTemporaryDirectory();
    final stamp = DateTime.now().millisecondsSinceEpoch;
    final path = '${directory.path}/playback_$stamp.m4a';
    await File(path).writeAsBytes(bytes, flush: true);
    _tempPath = path;
    await _player.open(Media(path));
  }

  @override
  Future<void> play() => _player.play();

  @override
  Future<void> pause() => _player.pause();

  @override
  Future<void> dispose() async {
    final path = _tempPath;
    _tempPath = null;
    await _player.dispose();
    if (path == null) return;
    try {
      final file = File(path);
      if (await file.exists()) await file.delete();
    } catch (_) {
      // Temp cleanup after playback never surfaces to the user.
    }
  }
}

/// Voice bubble: play/pause, slim progress bar and `current / total` time
/// (C7). When the player cannot decode the file the decrypted bytes are
/// offered through the OS opener instead — the web client's download link.
class AudioAttachment extends StatefulWidget {
  const AudioAttachment({
    super.key,
    required this.descriptor,
    required this.bytes,
    this.createPlayback,
  });

  final MediaDescriptor descriptor;
  final Uint8List bytes;

  /// Playback factory; null uses [MediaKitVoicePlayback] (tests inject).
  final VoicePlayback Function()? createPlayback;

  @override
  State<AudioAttachment> createState() => _AudioAttachmentState();
}

class _AudioAttachmentState extends State<AudioAttachment> {
  VoicePlayback? _playback;
  StreamSubscription<Duration>? _positionSub;
  StreamSubscription<Duration>? _durationSub;
  StreamSubscription<bool>? _playingSub;
  bool _playing = false;
  bool _failed = false;
  Duration _position = Duration.zero;
  Duration _total = Duration.zero;
  bool _opening = false;

  @override
  void initState() {
    super.initState();
    // The descriptor already carries the voice length (B2 `d`).
    final d = widget.descriptor.d;
    if (d != null) _total = Duration(milliseconds: (d * 1000).round());
  }

  @override
  void dispose() {
    _positionSub?.cancel();
    _durationSub?.cancel();
    _playingSub?.cancel();
    unawaited(_playback?.dispose());
    super.dispose();
  }

  Future<void> _toggle() async {
    if (_failed || _opening) return;
    final playback = _playback;
    if (playback == null) {
      await _openAndPlay();
      return;
    }
    if (_playing) {
      await playback.pause();
    } else {
      await playback.play();
    }
  }

  Future<void> _openAndPlay() async {
    _opening = true;
    try {
      final factory = widget.createPlayback ?? MediaKitVoicePlayback.new;
      final playback = factory();
      _playback = playback;
      _positionSub = playback.position.listen((value) {
        if (mounted) setState(() => _position = value);
      });
      _durationSub = playback.duration.listen((value) {
        if (mounted && value > Duration.zero) setState(() => _total = value);
      });
      _playingSub = playback.playing.listen((value) {
        if (mounted) setState(() => _playing = value);
      });
      await playback.open(widget.bytes, name: widget.descriptor.name);
      await playback.play();
    } catch (_) {
      _failed = true;
    } finally {
      _opening = false;
      if (mounted) setState(() {});
    }
  }

  Future<void> _openExternally() async {
    await MediaOpener.open(
      bytes: widget.bytes,
      mime: widget.descriptor.mime,
      name: widget.descriptor.name,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_failed) {
      return InkWell(
        key: const Key('audio-fallback'),
        borderRadius: BorderRadius.circular(12),
        onTap: _openExternally,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: AppColors.fill,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border),
          ),
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.download_outlined, size: 20, color: AppColors.textSecondary),
              SizedBox(width: 8),
              Text(
                'Download',
                style: TextStyle(fontSize: 13, color: AppColors.textPrimary),
              ),
            ],
          ),
        ),
      );
    }

    final percent = _total > Duration.zero
        ? (_position.inMilliseconds / _total.inMilliseconds).clamp(0.0, 1.0)
        : 0.0;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 36,
          height: 36,
          child: IconButton(
            key: Key(_playing ? 'voice-pause-button' : 'voice-play-button'),
            tooltip: _playing ? 'Pause' : 'Play',
            onPressed: _toggle,
            padding: EdgeInsets.zero,
            iconSize: 20,
            icon: Icon(
              _playing ? Icons.pause : Icons.play_arrow,
              color: AppColors.textPrimary,
            ),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(999),
                child: LinearProgressIndicator(
                  value: percent,
                  minHeight: 4,
                  backgroundColor: AppColors.surface,
                  valueColor: AlwaysStoppedAnimation<Color>(
                    Theme.of(context).colorScheme.primary,
                  ),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '${formatVoiceTime(_position)} / ${formatVoiceTime(_total)}',
                style: const TextStyle(
                  fontSize: 11,
                  fontFeatures: <FontFeature>[FontFeature.tabularFigures()],
                  color: AppColors.textMuted,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
