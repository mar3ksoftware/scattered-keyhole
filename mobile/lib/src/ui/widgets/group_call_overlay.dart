import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:livekit_client/livekit_client.dart' as lk;

import '../../calls/call_transport.dart';
import '../../calls/sfu_transport.dart';
import '../../models/group_call.dart';
import '../theme/app_theme.dart';

/// Full-height surface shown while a group call is joining or active.
///
/// Mesh calls render one peer connection per participant; SFU calls render
/// the tracks the LiveKit room reports. Both paths fall back to a name-only
/// placeholder until a video track exists, which also keeps widget tests free
/// of platform channels.
class GroupCallOverlay extends StatelessWidget {
  const GroupCallOverlay({
    super.key,
    required this.state,
    required this.topology,
    required this.participants,
    required this.transportFor,
    required this.localStream,
    required this.sfu,
    required this.onLeave,
  });

  final GroupCallState state;
  final String topology;
  final List<GroupCallParticipant> participants;

  /// Mesh peer transport for [userId]; null for SFU rooms.
  final CallTransport? Function(String userId) transportFor;

  /// Shared capture stream for the local preview (mesh).
  final MediaStream? localStream;

  /// Live SFU room for `sfu`-topology calls; null for mesh.
  final SfuTransport? sfu;

  final VoidCallback onLeave;

  @override
  Widget build(BuildContext context) {
    final joining = state == GroupCallState.joining;
    final count = participants.length + 1;
    return Material(
      key: const Key('group-call-overlay'),
      color: AppColors.background,
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: Row(
                children: [
                  const Icon(
                    Icons.groups_outlined,
                    size: 20,
                    color: AppColors.accentSoft,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      joining ? 'Joining group call…' : 'Group call · $count',
                      key: const Key('group-call-status'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                  _LocalPreview(stream: localStream, sfu: sfu),
                ],
              ),
            ),
            if (topology == CallTopology.sfu)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text(
                  'SFU room — this server forwards call media (less private than mesh).',
                  key: const Key('sfu-disclosure'),
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.textMuted,
                  ),
                ),
              ),
            Expanded(
              child: participants.isEmpty
                  ? Center(
                      child: Text(
                        joining
                            ? 'Waiting for the server…'
                            : 'Waiting for others to join…',
                        key: const Key('group-call-empty'),
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppColors.textMuted,
                        ),
                      ),
                    )
                  : GridView.builder(
                      padding: const EdgeInsets.all(12),
                      gridDelegate:
                          const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 2,
                        mainAxisSpacing: 8,
                        crossAxisSpacing: 8,
                        childAspectRatio: 0.8,
                      ),
                      itemCount: participants.length,
                      itemBuilder: (context, index) {
                        final participant = participants[index];
                        return _GroupTile(
                          participant: participant,
                          stream: transportFor(participant.userId)?.remoteStream,
                          videoTrack: _sfuTrackFor(participant.userId),
                        );
                      },
                    ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 20),
              child: ElevatedButton.icon(
                key: const Key('leave-group-call-overlay'),
                onPressed: onLeave,
                icon: const Icon(Icons.call_end, size: 20),
                label: const Text('Leave call'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.danger,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 24,
                    vertical: 14,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  lk.VideoTrack? _sfuTrackFor(String identity) {
    final room = sfu;
    if (room == null) return null;
    for (final participant in room.participants) {
      if (participant.identity == identity) return participant.videoTrack;
    }
    return null;
  }
}

/// One remote tile: video when available, name-only placeholder otherwise.
class _GroupTile extends StatelessWidget {
  const _GroupTile({
    required this.participant,
    required this.stream,
    required this.videoTrack,
  });

  final GroupCallParticipant participant;
  final MediaStream? stream;
  final lk.VideoTrack? videoTrack;

  @override
  Widget build(BuildContext context) {
    final track = videoTrack;
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: ColoredBox(
        color: AppColors.surfaceAlt,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (track != null)
              lk.VideoTrackRenderer(
                track,
                fit: lk.VideoViewFit.cover,
                placeholderBuilder: (_) => const SizedBox.shrink(),
              )
            else
              _StreamView(
                stream: stream,
                placeholder: Center(
                  child: Container(
                    width: 56,
                    height: 56,
                    decoration: const BoxDecoration(
                      color: AppColors.surface,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.person_outline,
                      size: 28,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ),
              ),
            Positioned(
              left: 8,
              right: 8,
              bottom: 8,
              child: Text(
                participant.username,
                key: Key('group-participant-${participant.userId}'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Corner preview of our own camera for the active call.
class _LocalPreview extends StatelessWidget {
  const _LocalPreview({required this.stream, required this.sfu});

  final MediaStream? stream;
  final SfuTransport? sfu;

  @override
  Widget build(BuildContext context) {
    final track = sfu?.localVideoTrack;
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: SizedBox(
        width: 72,
        height: 96,
        child: ColoredBox(
          color: AppColors.surfaceAlt,
          child: track != null
              ? lk.VideoTrackRenderer(
                  track,
                  fit: lk.VideoViewFit.cover,
                  mirrorMode: lk.VideoViewMirrorMode.mirror,
                  placeholderBuilder: (_) => const SizedBox.shrink(),
                )
              : _StreamView(
                  stream: stream,
                  mirror: true,
                  placeholder: const Center(
                    child: Icon(
                      Icons.videocam_off_outlined,
                      size: 18,
                      color: AppColors.textMuted,
                    ),
                  ),
                ),
        ),
      ),
    );
  }
}

/// Renders [stream] once it exists, falling back to [placeholder] otherwise.
class _StreamView extends StatefulWidget {
  const _StreamView({
    required this.stream,
    required this.placeholder,
    this.mirror = false,
  });

  final MediaStream? stream;
  final Widget placeholder;
  final bool mirror;

  @override
  State<_StreamView> createState() => _StreamViewState();
}

class _StreamViewState extends State<_StreamView> {
  RTCVideoRenderer? _renderer;
  bool _initialized = false;

  @override
  void initState() {
    super.initState();
    _bind();
  }

  @override
  void didUpdateWidget(covariant _StreamView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.stream, widget.stream)) _bind();
  }

  Future<void> _bind() async {
    final stream = widget.stream;
    if (stream == null) {
      final stale = _renderer;
      _renderer = null;
      _initialized = false;
      if (stale != null) {
        stale.srcObject = null;
        await stale.dispose();
      }
      if (mounted) setState(() {});
      return;
    }

    final renderer = _renderer ?? RTCVideoRenderer();
    _renderer = renderer;
    if (!_initialized) {
      await renderer.initialize();
      _initialized = true;
    }
    renderer.srcObject = stream;
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    final renderer = _renderer;
    _renderer = null;
    if (renderer != null) {
      renderer.srcObject = null;
      unawaited(renderer.dispose());
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final renderer = _renderer;
    if (renderer == null) return widget.placeholder;
    return RTCVideoView(
      renderer,
      objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
      mirror: widget.mirror,
      placeholderBuilder: (_) => widget.placeholder,
    );
  }
}
