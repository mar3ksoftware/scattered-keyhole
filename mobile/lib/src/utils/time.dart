/// Voice time formatting (spec D): `m:ss` — `0:07`, `4:59`.
String formatVoiceTime(Duration duration) {
  final totalSeconds = duration.inSeconds;
  if (totalSeconds < 0) return '0:00';
  final minutes = totalSeconds ~/ 60;
  final seconds = totalSeconds % 60;
  return '$minutes:${seconds.toString().padLeft(2, '0')}';
}
