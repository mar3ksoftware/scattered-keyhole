import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../../calls/call_transport.dart';
import '../../models/call.dart';
import '../theme/app_theme.dart';

/// Banner shown under the header while a 1:1 call is ringing.
///
/// Tapping elsewhere does not dismiss it: the only ways out are Accept or
/// Reject, matching the web client's call banner.
class IncomingCallBanner extends StatelessWidget {
  const IncomingCallBanner({
    super.key,
    required this.peerName,
    required this.onAccept,
    required this.onReject,
  });

  final String peerName;
  final VoidCallback onAccept;
  final VoidCallback onReject;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('incoming-call-banner'),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      decoration: const BoxDecoration(
        color: AppColors.surfaceGlass,
        border: Border(bottom: BorderSide(color: AppColors.border)),
      ),
      child: Row(
        children: [
          const Icon(Icons.call, size: 18, color: AppColors.accentSoft),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Incoming call from $peerName',
              key: const Key('incoming-call-label'),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 13,
                color: AppColors.textSecondary,
              ),
            ),
          ),
          TextButton(
            key: const Key('accept-call'),
            onPressed: onAccept,
            child: const Text('Accept'),
          ),
          TextButton(
            key: const Key('reject-call'),
            onPressed: onReject,
            style: TextButton.styleFrom(foregroundColor: AppColors.dangerSoft),
            child: const Text('Reject'),
          ),
        ],
      ),
    );
  }
}

/// Full-height call surface covering the conversation while a call is
/// dialing or connected.
///
/// While `calling` there is no remote video yet, so the peer name and a
/// "Calling…" label take its place; the local preview and the End call
/// button are shown in both states.
class CallOverlay extends StatelessWidget {
  const CallOverlay({
    super.key,
    required this.state,
    required this.peerName,
    required this.transport,
    required this.onEnd,
  });

  final CallState state;
  final String peerName;

  /// Live media handle; null only in tests that fake the transport.
  final CallTransport? transport;
  final VoidCallback onEnd;

  @override
  Widget build(BuildContext context) {
    final connected = state == CallState.connected;
    return Material(
      key: const Key('call-overlay'),
      color: AppColors.background,
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (connected)
            _CallVideo(
              stream: transport?.remoteStream,
              placeholder: _CallPlaceholder(
                label: peerName,
                detail: 'Waiting for video…',
                icon: Icons.person_outline,
              ),
            )
          else
            _CallPlaceholder(
              label: peerName,
              detail: 'Calling…',
              icon: Icons.person_outline,
            ),
          Positioned(
            top: 16,
            right: 16,
            child: _LocalPreview(stream: transport?.localStream),
          ),
          if (connected)
            Positioned(
              top: 20,
              left: 16,
              right: 136,
              child: Text(
                peerName,
                key: const Key('call-peer-name'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 40,
            child: Center(
              child: ElevatedButton.icon(
                key: const Key('end-call'),
                onPressed: onEnd,
                icon: const Icon(Icons.call_end, size: 20),
                label: const Text('End call'),
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
          ),
        ],
      ),
    );
  }
}

/// Corner preview of our own camera, mirrored like a selfie view.
class _LocalPreview extends StatelessWidget {
  const _LocalPreview({required this.stream});

  final MediaStream? stream;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: SizedBox(
        width: 96,
        height: 128,
        child: ColoredBox(
          color: AppColors.surfaceAlt,
          child: _CallVideo(
            stream: stream,
            mirror: true,
            placeholder: const Center(
              child: Icon(
                Icons.videocam_off_outlined,
                size: 20,
                color: AppColors.textMuted,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Centered status block used before any video is available.
class _CallPlaceholder extends StatelessWidget {
  const _CallPlaceholder({
    required this.label,
    required this.detail,
    required this.icon,
  });

  final String label;
  final String detail;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 88,
            height: 88,
            decoration: const BoxDecoration(
              color: AppColors.surfaceAlt,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 40, color: AppColors.textSecondary),
          ),
          const SizedBox(height: 16),
          Text(
            label,
            key: const Key('call-peer-label'),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w600,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            detail,
            key: const Key('call-status-detail'),
            style: const TextStyle(
              fontSize: 13,
              color: AppColors.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}

/// Renders [stream] once it exists, falling back to [placeholder] otherwise.
///
/// The renderer is created lazily: widget tests run without a WebRTC platform
/// channel and only ever pass a null stream.
class _CallVideo extends StatefulWidget {
  const _CallVideo({
    required this.stream,
    required this.placeholder,
    this.mirror = false,
  });

  final MediaStream? stream;
  final Widget placeholder;
  final bool mirror;

  @override
  State<_CallVideo> createState() => _CallVideoState();
}

class _CallVideoState extends State<_CallVideo> {
  RTCVideoRenderer? _renderer;
  bool _initialized = false;

  @override
  void initState() {
    super.initState();
    _bind();
  }

  @override
  void didUpdateWidget(covariant _CallVideo oldWidget) {
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
