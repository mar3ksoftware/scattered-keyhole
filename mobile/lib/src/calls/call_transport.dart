// ── Call media transport ──────────────────────────────────────────────────
//
// The controller drives the WebRTC handshake through this narrow interface so
// its signaling logic stays testable: `flutter_webrtc` needs a real platform
// channel (and thus a device) that widget tests do not have. The production
// implementation lives at the bottom of this file; tests substitute a fake.

import 'dart:convert';

// Prefixed: `WebRtcCallTransport` implements a method named
// `createPeerConnection`, which would otherwise shadow the package's
// top-level helper of the same name.
import 'package:flutter_webrtc/flutter_webrtc.dart' as webrtc;

/// One peer connection plus its local capture stream.
///
/// Every method mirrors the corresponding step of the web client's
/// `frontend/src/lib/calls.ts` helpers, with SDP and ICE candidates crossing
/// the boundary as plain strings (the wire format).
abstract interface class CallTransport {
  /// Opens the microphone and camera. Throws when the platform denies
  /// access; the controller turns that into a user-visible error.
  Future<void> getUserMedia({required bool audio, required bool video});

  /// Creates the peer connection and wires its events.
  ///
  /// [onIceCandidate] receives `JSON.stringify`-shaped candidate JSON,
  /// [onTrack] fires once a remote track lands, and
  /// [onConnectionStateChange] reports `connected`, `disconnected`, `failed`
  /// or `closed`.
  Future<void> createPeerConnection({
    required void Function(String candidateJson) onIceCandidate,
    required void Function() onTrack,
    required void Function(String state) onConnectionStateChange,
  });

  /// Adds every local track to the peer connection.
  ///
  /// [stream] overrides the transport's own capture stream; group calls
  /// capture once and share that stream across every peer connection.
  Future<void> addTracks({webrtc.MediaStream? stream});

  /// Creates a local offer and returns its SDP.
  Future<String> createOffer();

  /// Creates a local answer and returns its SDP.
  Future<String> createAnswer();

  /// Applies the local description (`offer` or `answer`).
  Future<void> setLocalDescription(String type, String sdp);

  /// Applies the remote description (`offer` or `answer`).
  Future<void> setRemoteDescription(String type, String sdp);

  /// Adds a remote ICE candidate given in wire (JSON string) form.
  Future<void> addIceCandidate(String candidateJson);

  /// Closes the peer connection and stops the local capture tracks.
  Future<void> close();

  /// Local capture stream, available after [getUserMedia].
  webrtc.MediaStream? get localStream;

  /// Stream carrying the peer's tracks, available after the first
  /// [createPeerConnection] `onTrack` event.
  webrtc.MediaStream? get remoteStream;
}

/// Production [CallTransport] backed by `flutter_webrtc`.
class WebRtcCallTransport implements CallTransport {
  /// The single STUN server both clients use (see `calls.ts`).
  static const String _stunUrl = 'stun:stun.l.google.com:19302';

  webrtc.RTCPeerConnection? _pc;
  webrtc.MediaStream? _localStream;
  webrtc.MediaStream? _remoteStream;

  @override
  webrtc.MediaStream? get localStream => _localStream;

  @override
  webrtc.MediaStream? get remoteStream => _remoteStream;

  @override
  Future<void> getUserMedia({required bool audio, required bool video}) async {
    _localStream =
        await webrtc.navigator.mediaDevices.getUserMedia(<String, dynamic>{
      'audio': audio,
      'video': video,
    });
  }

  @override
  Future<void> createPeerConnection({
    required void Function(String candidateJson) onIceCandidate,
    required void Function() onTrack,
    required void Function(String state) onConnectionStateChange,
  }) async {
    final pc = await webrtc.createPeerConnection(<String, dynamic>{
      'iceServers': <Map<String, dynamic>>[
        <String, dynamic>{'urls': _stunUrl},
      ],
    });

    pc.onIceCandidate = (candidate) {
      // The platform reports an empty candidate once gathering finishes; the
      // web client filters those out and so do we.
      final value = candidate.candidate;
      if (value == null || value.isEmpty) return;
      onIceCandidate(jsonEncode(candidate.toMap()));
    };
    pc.onTrack = (event) {
      if (event.streams.isEmpty) return;
      _remoteStream = event.streams.first;
      onTrack();
    };
    pc.onConnectionState = (state) {
      onConnectionStateChange(_connectionStateName(state));
    };

    _pc = pc;
  }

  @override
  Future<void> addTracks({webrtc.MediaStream? stream}) async {
    final pc = _pc;
    final source = stream ?? _localStream;
    if (pc == null || source == null) return;
    for (final track in source.getTracks()) {
      await pc.addTrack(track, source);
    }
  }

  @override
  Future<String> createOffer() async {
    final offer = await _requirePc().createOffer();
    return offer.sdp ?? '';
  }

  @override
  Future<String> createAnswer() async {
    final answer = await _requirePc().createAnswer();
    return answer.sdp ?? '';
  }

  @override
  Future<void> setLocalDescription(String type, String sdp) async {
    await _requirePc()
        .setLocalDescription(webrtc.RTCSessionDescription(sdp, type));
  }

  @override
  Future<void> setRemoteDescription(String type, String sdp) async {
    await _requirePc()
        .setRemoteDescription(webrtc.RTCSessionDescription(sdp, type));
  }

  @override
  Future<void> addIceCandidate(String candidateJson) async {
    final decoded = jsonDecode(candidateJson);
    if (decoded is! Map) return;
    final map = Map<String, dynamic>.from(decoded);
    final candidate = map['candidate'];
    if (candidate is! String || candidate.isEmpty) return;
    final sdpMid = map['sdpMid'];
    final sdpMLineIndex = map['sdpMLineIndex'];
    await _requirePc().addCandidate(
      webrtc.RTCIceCandidate(
        candidate,
        sdpMid is String ? sdpMid : null,
        sdpMLineIndex is num ? sdpMLineIndex.toInt() : null,
      ),
    );
  }

  @override
  Future<void> close() async {
    final pc = _pc;
    _pc = null;
    if (pc != null) {
      try {
        await pc.close();
      } catch (_) {
        // The platform may already have torn the connection down; the tracks
        // below still need stopping.
      }
    }
    final stream = _localStream;
    _localStream = null;
    if (stream != null) {
      for (final track in stream.getTracks()) {
        try {
          await track.stop();
        } catch (_) {
          // A track that already ended needs no further cleanup.
        }
      }
    }
    _remoteStream = null;
  }

  webrtc.RTCPeerConnection _requirePc() {
    final pc = _pc;
    if (pc == null) {
      throw StateError('Peer connection is not initialised');
    }
    return pc;
  }

  /// Maps the platform enum onto the web `RTCPeerConnectionState` strings.
  static String _connectionStateName(webrtc.RTCPeerConnectionState state) {
    switch (state) {
      case webrtc.RTCPeerConnectionState.RTCPeerConnectionStateConnected:
        return 'connected';
      case webrtc.RTCPeerConnectionState.RTCPeerConnectionStateDisconnected:
        return 'disconnected';
      case webrtc.RTCPeerConnectionState.RTCPeerConnectionStateFailed:
        return 'failed';
      case webrtc.RTCPeerConnectionState.RTCPeerConnectionStateClosed:
        return 'closed';
      case webrtc.RTCPeerConnectionState.RTCPeerConnectionStateNew:
        return 'new';
      case webrtc.RTCPeerConnectionState.RTCPeerConnectionStateConnecting:
        return 'connecting';
    }
  }
}
