// ── Audio settings (roadmap 8c) ───────────────────────────────────────
// Preferences only — no messages, keys or conversation state live here, so
// the "no chat data in storage" rule is untouched.

export type AudioBitrate = 'voice' | 'music';

export type AudioSettings = {
  readonly bitrate: AudioBitrate;
  readonly echoCancellation: boolean;
  readonly noiseSuppression: boolean;
  readonly autoGainControl: boolean;
  readonly inputDeviceId: string | null;
  readonly outputDeviceId: string | null;
  // `event.code` values, empty string = unbound.
  readonly pttKey: string;
  readonly ptmKey: string;
};

export const AUDIO_SETTINGS_STORAGE_KEY = 'sk.audioSettings';
export const AUDIO_SETTINGS_VERSION = 1;

// Opus caps: 32 kbps is transparent for speech, 128 kbps leaves headroom for
// music. These are `maxBitrate` ceilings, not reservations, so the encoder
// still backs off on a weak link.
export const AUDIO_BITRATE_BPS: Readonly<Record<AudioBitrate, number>> = {
  voice: 32_000,
  music: 128_000,
};

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  bitrate: 'voice',
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  inputDeviceId: null,
  outputDeviceId: null,
  // Opt-in: binding Space by default would swallow typing in every input.
  pttKey: '',
  ptmKey: '',
};

export type AudioSettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): AudioSettingsStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Private-mode browsers throw on access.
    return null;
  }
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asDeviceId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asKeyCode(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBitrate(value: unknown): AudioBitrate {
  return value === 'music' || value === 'voice' ? value : DEFAULT_AUDIO_SETTINGS.bitrate;
}

export function isDuplicateKeyBinding(pttKey: string, ptmKey: string): boolean {
  return pttKey.length > 0 && pttKey === ptmKey;
}

// Coerces untrusted input (stored JSON, partial patches) into a complete
// settings object. Duplicate bindings are dropped to unbound: a single key
// cannot be both push-to-talk and push-to-mute.
export function sanitizeAudioSettings(input: Partial<AudioSettings>): AudioSettings {
  const pttKey = asKeyCode(input.pttKey);
  const ptmKey = asKeyCode(input.ptmKey);
  const duplicate = isDuplicateKeyBinding(pttKey, ptmKey);
  return {
    bitrate: asBitrate(input.bitrate),
    echoCancellation: asBoolean(input.echoCancellation, DEFAULT_AUDIO_SETTINGS.echoCancellation),
    noiseSuppression: asBoolean(input.noiseSuppression, DEFAULT_AUDIO_SETTINGS.noiseSuppression),
    autoGainControl: asBoolean(input.autoGainControl, DEFAULT_AUDIO_SETTINGS.autoGainControl),
    inputDeviceId: asDeviceId(input.inputDeviceId),
    outputDeviceId: asDeviceId(input.outputDeviceId),
    pttKey: duplicate ? '' : pttKey,
    ptmKey: duplicate ? '' : ptmKey,
  };
}

export function loadAudioSettings(
  storage: AudioSettingsStorage | null = defaultStorage(),
): AudioSettings {
  if (storage === null) return DEFAULT_AUDIO_SETTINGS;
  let raw: string | null;
  try {
    raw = storage.getItem(AUDIO_SETTINGS_STORAGE_KEY);
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
  if (raw === null) return DEFAULT_AUDIO_SETTINGS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_AUDIO_SETTINGS;
  const record = parsed as Record<string, unknown>;
  if (record['v'] !== AUDIO_SETTINGS_VERSION) return DEFAULT_AUDIO_SETTINGS;
  return sanitizeAudioSettings(record as Partial<AudioSettings>);
}

export function saveAudioSettings(
  settings: AudioSettings,
  storage: AudioSettingsStorage | null = defaultStorage(),
): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(
      AUDIO_SETTINGS_STORAGE_KEY,
      JSON.stringify({ v: AUDIO_SETTINGS_VERSION, ...settings }),
    );
    return true;
  } catch {
    return false;
  }
}

// getUserMedia audio constraints: exact device when chosen, plus the three
// DSP switches. Music asks for stereo capture where the device supports it;
// voice stays mono so the encoder spends bits on speech instead of a second
// near-silent channel.
export function buildAudioConstraints(settings: AudioSettings): MediaTrackConstraints {
  return {
    ...(settings.inputDeviceId !== null ? { deviceId: { exact: settings.inputDeviceId } } : {}),
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    channelCount: { ideal: settings.bitrate === 'music' ? 2 : 1 },
  };
}

// Opus bitrate ceiling on a live sender. `encodings` is empty on some
// browsers until the first packet; seeding one entry keeps setParameters
// working in that window.
export async function applyBitrate(sender: RTCRtpSender, bitrate: AudioBitrate): Promise<void> {
  const params = sender.getParameters();
  if (params.encodings.length === 0) params.encodings = [{}];
  for (const encoding of params.encodings) {
    encoding.maxBitrate = AUDIO_BITRATE_BPS[bitrate];
  }
  await sender.setParameters(params);
}

export async function applyBitrateToConnection(
  pc: RTCPeerConnection,
  bitrate: AudioBitrate,
): Promise<void> {
  const senders = pc.getSenders().filter((sender) => sender.track?.kind === 'audio');
  await Promise.all(senders.map((sender) => applyBitrate(sender, bitrate).catch(() => undefined)));
}

type SinkCapableStream = MediaStream & {
  readonly setSinkId?: (deviceId: string) => Promise<void>;
};

// Output device selection: Chrome exposes setSinkId on media elements, not on
// MediaStream, so this is a feature-detected no-op where it is missing. The
// call overlay additionally points its <audio> sink at the chosen device.
export function applyStreamSink(stream: MediaStream | null, outputDeviceId: string | null): void {
  if (stream === null || outputDeviceId === null) return;
  const capable = stream as SinkCapableStream;
  if (typeof capable.setSinkId !== 'function') return;
  void capable.setSinkId(outputDeviceId).catch(() => undefined);
}

export type KeyCaptureTarget = 'ptt' | 'ptm';

export type KeyCaptureResult =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'conflict'; readonly message: string }
  | { readonly kind: 'bound'; readonly patch: Partial<AudioSettings> };

// Turns the next key press into a binding patch. Escape cancels, and a key
// already owned by the other action is refused instead of silently clobbering
// it. Kept pure so the capture UI stays a thin wrapper.
export function resolveKeyCapture(
  target: KeyCaptureTarget,
  code: string,
  settings: AudioSettings,
): KeyCaptureResult {
  if (code === 'Escape') return { kind: 'cancelled' };
  const otherKey = target === 'ptt' ? settings.ptmKey : settings.pttKey;
  if (code === otherKey) {
    return {
      kind: 'conflict',
      message:
        target === 'ptt'
          ? 'That key is already push-to-mute. Pick another one.'
          : 'That key is already push-to-talk. Pick another one.',
    };
  }
  return { kind: 'bound', patch: target === 'ptt' ? { pttKey: code } : { ptmKey: code } };
}

const NAMED_KEY_LABELS: Readonly<Record<string, string>> = {
  Space: 'Space',
  Escape: 'Esc',
  Tab: 'Tab',
  Enter: 'Enter',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  ArrowUp: 'Up arrow',
  ArrowDown: 'Down arrow',
  ArrowLeft: 'Left arrow',
  ArrowRight: 'Right arrow',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  MetaLeft: 'Left Meta',
  MetaRight: 'Right Meta',
  CapsLock: 'Caps Lock',
};

// `event.code` → short human label. Storage always keeps the raw code so the
// binding survives keyboard-layout changes.
export function formatKeyCode(code: string): string {
  if (code.length === 0) return 'Unbound';
  const named = NAMED_KEY_LABELS[code];
  if (named !== undefined) return named;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('F') && /^F\d{1,2}$/.test(code)) return code;
  return code;
}
