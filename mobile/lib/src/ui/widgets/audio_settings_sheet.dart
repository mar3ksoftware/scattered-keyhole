import 'package:flutter/material.dart';

import '../../state/audio_settings.dart';
import '../../state/chat_controller.dart';
import '../theme/app_theme.dart';

Future<void> showAudioSettingsSheet(
  BuildContext context, {
  required ChatController controller,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (sheetContext) => AudioSettingsSheet(controller: controller),
  );
}

class AudioSettingsSheet extends StatefulWidget {
  const AudioSettingsSheet({super.key, required this.controller});

  final ChatController controller;

  @override
  State<AudioSettingsSheet> createState() => _AudioSettingsSheetState();
}

class _AudioSettingsSheetState extends State<AudioSettingsSheet> {
  @override
  Widget build(BuildContext context) {
    final settings = widget.controller.audioSettings;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Audio settings',
              key: Key('audio-settings-sheet'),
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 12),
            const Text('Call quality', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textMuted)),
            const SizedBox(height: 6),
            SegmentedButton<AudioBitrate>(
              segments: const <ButtonSegment<AudioBitrate>>[
                ButtonSegment(value: AudioBitrate.voice, label: Text('Voice')),
                ButtonSegment(value: AudioBitrate.music, label: Text('Music')),
              ],
              selected: <AudioBitrate>{settings.bitrate},
              onSelectionChanged: (selection) {
                widget.controller.updateAudioSettings(settings.copyWith(bitrate: selection.first));
                setState(() {});
              },
            ),
            const SizedBox(height: 12),
            SwitchListTile(
              title: const Text('Echo cancellation'),
              value: settings.echoCancellation,
              onChanged: (v) {
                widget.controller.updateAudioSettings(settings.copyWith(echoCancellation: v));
                setState(() {});
              },
            ),
            SwitchListTile(
              title: const Text('Noise suppression'),
              value: settings.noiseSuppression,
              onChanged: (v) {
                widget.controller.updateAudioSettings(settings.copyWith(noiseSuppression: v));
                setState(() {});
              },
            ),
            SwitchListTile(
              title: const Text('Auto gain control'),
              value: settings.autoGainControl,
              onChanged: (v) {
                widget.controller.updateAudioSettings(settings.copyWith(autoGainControl: v));
                setState(() {});
              },
            ),
            const SizedBox(height: 8),
            const Text('Output device selection is not supported on this platform', style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
          ],
        ),
      ),
    );
  }
}
