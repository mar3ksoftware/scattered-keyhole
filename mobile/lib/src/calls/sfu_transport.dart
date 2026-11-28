// ── SFU group call transport ──────────────────────────────────────────────
//
// Group rooms whose topology is `sfu` do not use peer-to-peer mesh links: the
// server hands out short-lived LiveKit credentials and the client joins a
// media room where the SFU forwards tracks. The controller talks to that room
// through this interface so widget tests never need the platform channels the
// LiveKit SDK opens.

import 'package:livekit_client/livekit_client.dart' as lk;

/// One remote participant of an SFU room, reduced to what the call surface
/// renders (name plus the subscribed camera track, when there is one).
class SfuParticipant {
  const SfuParticipant({
    required this.identity,
    required this.name,
    this.videoTrack,
  });

  final String identity;
  final String name;
  final lk.VideoTrack? videoTrack;
}

/// Narrow view of a LiveKit room.
abstract interface class SfuTransport {
  /// Fires whenever the participant list or any subscribed track changes.
  void Function()? get onChanged;
  set onChanged(void Function()? value);

  /// Joins the room described by [url] and [token] and publishes our mic and
  /// camera. Throws when the connection or capture fails.
  Future<void> connect(String url, String token);

  /// Remote participants, in the order the SDK reports them.
  List<SfuParticipant> get participants;

  /// Our own camera track for the corner preview, when publishing succeeded.
  lk.VideoTrack? get localVideoTrack;

  /// Leaves the room and releases every SDK resource.
  Future<void> dispose();
}

/// Builds the production transport; tests inject a fake factory instead.
SfuTransport defaultSfuTransport() => LiveKitSfuTransport();

/// [SfuTransport] backed by `livekit_client`.
class LiveKitSfuTransport implements SfuTransport {
  lk.Room? _room;
  lk.EventsListener<lk.RoomEvent>? _listener;
  final Map<String, lk.RemoteParticipant> _remotes =
      <String, lk.RemoteParticipant>{};

  @override
  void Function()? onChanged;

  @override
  Future<void> connect(String url, String token) async {
    final room = lk.Room();
    _room = room;

    final listener = room.createListener();
    _listener = listener;
    listener.on<lk.ParticipantConnectedEvent>((event) {
      _remotes[event.participant.identity] = event.participant;
      onChanged?.call();
    });
    listener.on<lk.ParticipantDisconnectedEvent>((event) {
      _remotes.remove(event.participant.identity);
      onChanged?.call();
    });
    // Subscription changes arrive separately from participant changes; both
    // can bring a new video track into the surface.
    listener.on<lk.TrackSubscribedEvent>((_) => onChanged?.call());
    listener.on<lk.TrackUnsubscribedEvent>((_) => onChanged?.call());

    await room.connect(url, token);
    for (final participant in room.remoteParticipants.values) {
      _remotes[participant.identity] = participant;
    }
    await room.localParticipant?.setMicrophoneEnabled(true);
    await room.localParticipant?.setCameraEnabled(true);
    onChanged?.call();
  }

  @override
  List<SfuParticipant> get participants {
    return <SfuParticipant>[
      for (final participant in _remotes.values)
        SfuParticipant(
          identity: participant.identity,
          name: participant.name.isEmpty
              ? participant.identity
              : participant.name,
          videoTrack: _firstVideoTrack(participant),
        ),
    ];
  }

  @override
  lk.VideoTrack? get localVideoTrack {
    final local = _room?.localParticipant;
    if (local == null) return null;
    return _firstVideoTrack(local);
  }

  static lk.VideoTrack? _firstVideoTrack(lk.Participant<dynamic> participant) {
    for (final publication in participant.videoTrackPublications) {
      final track = publication.track;
      if (track is lk.VideoTrack) return track;
    }
    return null;
  }

  @override
  Future<void> dispose() async {
    final listener = _listener;
    _listener = null;
    if (listener != null) {
      try {
        await listener.dispose();
      } catch (_) {
        // A listener already torn down needs no further cleanup.
      }
    }
    final room = _room;
    _room = null;
    _remotes.clear();
    if (room == null) return;
    try {
      await room.disconnect();
    } catch (_) {
      // The engine may already be closed after a network drop.
    }
    try {
      await room.dispose();
    } catch (_) {
      // Disposal is best-effort; nothing user-visible depends on it.
    }
  }
}
