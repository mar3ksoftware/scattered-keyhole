// Fake SFU transport for group-call tests.
//
// The production LiveKit transport needs platform channels, so tests inject
// this fake factory instead and drive the room state directly.

import 'package:livekit_client/livekit_client.dart' as lk;
import 'package:scattered_keyhole/src/calls/sfu_transport.dart';

class FakeSfuTransport implements SfuTransport {
  final List<String> log = <String>[];
  bool connected = false;
  bool disposed = false;
  bool failConnect = false;

  final List<SfuParticipant> _participants = <SfuParticipant>[];

  @override
  void Function()? onChanged;

  @override
  Future<void> connect(String url, String token) async {
    log.add('connect:$url:$token');
    if (failConnect) throw Exception('connect failed');
    connected = true;
  }

  @override
  List<SfuParticipant> get participants =>
      List<SfuParticipant>.unmodifiable(_participants);

  @override
  lk.VideoTrack? get localVideoTrack => null;

  @override
  Future<void> dispose() async {
    log.add('dispose');
    disposed = true;
  }

  /// Test driver: replaces the participant list and notifies the controller.
  void setParticipants(List<SfuParticipant> next) {
    _participants
      ..clear()
      ..addAll(next);
    onChanged?.call();
  }
}
