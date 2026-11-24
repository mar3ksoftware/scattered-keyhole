// Fake media transport shared by the call tests.
//
// Lives outside `lib/` on purpose: the production transport needs a WebRTC
// platform channel, which neither `flutter test` nor widget tests provide.

import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:scattered_keyhole/src/calls/call_transport.dart';

/// Records every transport step and lets tests drive the callbacks the real
/// peer connection would fire.
class FakeCallTransport implements CallTransport {
  /// Every method call, in order, as `name` or `name:detail`.
  final List<String> log = <String>[];

  /// SDP returned by [createOffer].
  String offerSdp = 'offer-sdp';

  /// SDP returned by [createAnswer].
  String answerSdp = 'answer-sdp';

  /// When true, [getUserMedia] throws as a denied permission would.
  bool denyMedia = false;

  /// Set once [close] runs.
  bool closed = false;

  void Function(String candidateJson)? _onIceCandidate;
  void Function()? _onTrack;
  void Function(String state)? _onConnectionStateChange;

  @override
  MediaStream? localStream;

  @override
  MediaStream? remoteStream;

  @override
  Future<void> getUserMedia({required bool audio, required bool video}) async {
    log.add('getUserMedia:$audio:$video');
    if (denyMedia) throw Exception('permission denied');
  }

  @override
  Future<void> createPeerConnection({
    required void Function(String candidateJson) onIceCandidate,
    required void Function() onTrack,
    required void Function(String state) onConnectionStateChange,
  }) async {
    log.add('createPeerConnection');
    _onIceCandidate = onIceCandidate;
    _onTrack = onTrack;
    _onConnectionStateChange = onConnectionStateChange;
  }

  @override
  Future<void> addTracks() async => log.add('addTracks');

  @override
  Future<String> createOffer() async {
    log.add('createOffer');
    return offerSdp;
  }

  @override
  Future<String> createAnswer() async {
    log.add('createAnswer');
    return answerSdp;
  }

  @override
  Future<void> setLocalDescription(String type, String sdp) async =>
      log.add('setLocalDescription:$type:$sdp');

  @override
  Future<void> setRemoteDescription(String type, String sdp) async =>
      log.add('setRemoteDescription:$type:$sdp');

  @override
  Future<void> addIceCandidate(String candidateJson) async =>
      log.add('addIceCandidate:$candidateJson');

  @override
  Future<void> close() async {
    log.add('close');
    closed = true;
  }

  // ── Test drivers ───────────────────────────────────────────────────────

  /// Fires a local ICE candidate, as the peer connection would.
  void emitIceCandidate(String candidateJson) {
    _onIceCandidate?.call(candidateJson);
  }

  /// Reports a connection state change.
  void emitConnectionState(String state) {
    _onConnectionStateChange?.call(state);
  }

  /// Reports the arrival of a remote track.
  void emitTrack() {
    _onTrack?.call();
  }
}
