import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUDIO_BITRATE_BPS,
  AUDIO_SETTINGS_STORAGE_KEY,
  type AudioSettings,
  applyBitrate,
  applyStreamSink,
  buildAudioConstraints,
  DEFAULT_AUDIO_SETTINGS,
  formatKeyCode,
  isDuplicateKeyBinding,
  loadAudioSettings,
  resolveKeyCapture,
  sanitizeAudioSettings,
  saveAudioSettings,
} from './audioSettings';

type FakeStorage = {
  readonly data: Record<string, string>;
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
};

function fakeStorage(initial: Record<string, string> = {}): FakeStorage {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const MUSIC_SETTINGS: AudioSettings = {
  bitrate: 'music',
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  inputDeviceId: 'mic-1',
  outputDeviceId: 'spk-1',
  pttKey: 'KeyM',
  ptmKey: '',
};

test('audio settings default to voice, all DSP on, no devices, no bindings', () => {
  assert.deepEqual(loadAudioSettings(null), DEFAULT_AUDIO_SETTINGS);
  assert.equal(DEFAULT_AUDIO_SETTINGS.bitrate, 'voice');
  assert.equal(DEFAULT_AUDIO_SETTINGS.echoCancellation, true);
  assert.equal(DEFAULT_AUDIO_SETTINGS.noiseSuppression, true);
  assert.equal(DEFAULT_AUDIO_SETTINGS.autoGainControl, true);
  assert.equal(DEFAULT_AUDIO_SETTINGS.inputDeviceId, null);
  assert.equal(DEFAULT_AUDIO_SETTINGS.outputDeviceId, null);
  assert.equal(DEFAULT_AUDIO_SETTINGS.pttKey, '');
  assert.equal(DEFAULT_AUDIO_SETTINGS.ptmKey, '');
});

test('save/load round-trips every field under a versioned key', () => {
  const storage = fakeStorage();
  assert.equal(saveAudioSettings(MUSIC_SETTINGS, storage), true);
  assert.deepEqual(loadAudioSettings(storage), MUSIC_SETTINGS);
  const raw = storage.data[AUDIO_SETTINGS_STORAGE_KEY] ?? '';
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  assert.equal(parsed['v'], 1);
  assert.equal(parsed['bitrate'], 'music');
});

test('corrupt or foreign storage payloads fall back to defaults', () => {
  for (const raw of ['{not json', 'null', '[]', '"voice"', '42']) {
    const storage = fakeStorage({ [AUDIO_SETTINGS_STORAGE_KEY]: raw });
    assert.deepEqual(loadAudioSettings(storage), DEFAULT_AUDIO_SETTINGS);
  }
});

test('an unknown storage version is ignored', () => {
  const storage = fakeStorage({
    [AUDIO_SETTINGS_STORAGE_KEY]: JSON.stringify({ v: 2, bitrate: 'music' }),
  });
  assert.deepEqual(loadAudioSettings(storage), DEFAULT_AUDIO_SETTINGS);
});

test('bad field types fall back per field instead of dropping the object', () => {
  const storage = fakeStorage({
    [AUDIO_SETTINGS_STORAGE_KEY]: JSON.stringify({
      v: 1,
      bitrate: 'lossless',
      echoCancellation: 'yes',
      noiseSuppression: false,
      autoGainControl: null,
      inputDeviceId: 42,
      outputDeviceId: 'spk-1',
      pttKey: 7,
      ptmKey: 'KeyN',
    }),
  });
  assert.deepEqual(loadAudioSettings(storage), {
    ...DEFAULT_AUDIO_SETTINGS,
    noiseSuppression: false,
    outputDeviceId: 'spk-1',
    ptmKey: 'KeyN',
  });
});

test('a key cannot be both push-to-talk and push-to-mute', () => {
  assert.equal(isDuplicateKeyBinding('KeyM', 'KeyM'), true);
  assert.equal(isDuplicateKeyBinding('', ''), false);
  assert.equal(isDuplicateKeyBinding('KeyM', ''), false);
  assert.equal(isDuplicateKeyBinding('', 'KeyM'), false);
  assert.deepEqual(sanitizeAudioSettings({ pttKey: 'KeyM', ptmKey: 'KeyM' }), {
    ...DEFAULT_AUDIO_SETTINGS,
  });
});

test('audio constraints carry the chosen device and the DSP switches', () => {
  const music = buildAudioConstraints(MUSIC_SETTINGS);
  assert.deepEqual(music.deviceId, { exact: 'mic-1' });
  assert.equal(music.echoCancellation, false);
  assert.equal(music.noiseSuppression, false);
  assert.equal(music.autoGainControl, false);
  assert.deepEqual(music.channelCount, { ideal: 2 });

  const voice = buildAudioConstraints(DEFAULT_AUDIO_SETTINGS);
  assert.equal('deviceId' in voice, false, 'default device means no deviceId constraint');
  assert.equal(voice.echoCancellation, true);
  assert.equal(voice.noiseSuppression, true);
  assert.equal(voice.autoGainControl, true);
  assert.deepEqual(voice.channelCount, { ideal: 1 });
});

test('bitrate mapping is 32 kbps voice and 128 kbps music', () => {
  assert.equal(AUDIO_BITRATE_BPS.voice, 32_000);
  assert.equal(AUDIO_BITRATE_BPS.music, 128_000);
});

test('applyBitrate sets the Opus maxBitrate on every encoding', async () => {
  const seen: Array<Record<string, unknown>> = [];
  const params = { encodings: [{ maxBitrate: 1_000 }, {}] as RTCRtpEncodingParameters[] };
  const sender = {
    getParameters: () => params,
    setParameters: async (next: RTCRtpSendParameters) => {
      seen.push(next as unknown as Record<string, unknown>);
    },
  } as unknown as RTCRtpSender;

  await applyBitrate(sender, 'music');
  assert.deepEqual(
    params.encodings.map((encoding) => encoding.maxBitrate),
    [128_000, 128_000],
  );
  assert.equal(seen.length, 1);
});

test('applyBitrate seeds an encoding when the sender reports none', async () => {
  let applied: RTCRtpSendParameters | null = null;
  const sender = {
    getParameters: () => ({ encodings: [] }) as RTCRtpSendParameters,
    setParameters: async (next: RTCRtpSendParameters) => {
      applied = next;
    },
  } as unknown as RTCRtpSender;

  await applyBitrate(sender, 'voice');
  assert.deepEqual(
    applied?.encodings.map((encoding) => encoding.maxBitrate),
    [32_000],
  );
});

test('applyStreamSink is feature-detected and skipped without a device', () => {
  const calls: string[] = [];
  const capable = {
    setSinkId: async (deviceId: string) => {
      calls.push(deviceId);
    },
  } as unknown as MediaStream;

  applyStreamSink(capable, 'spk-1');
  applyStreamSink(capable, null);
  applyStreamSink({} as MediaStream, 'spk-2');
  applyStreamSink(null, 'spk-3');
  assert.deepEqual(calls, ['spk-1']);
});

test('key capture binds a fresh code, cancels on Escape and refuses duplicates', () => {
  const settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS, ptmKey: 'KeyN' };

  assert.deepEqual(resolveKeyCapture('ptt', 'KeyM', settings), {
    kind: 'bound',
    patch: { pttKey: 'KeyM' },
  });
  assert.deepEqual(resolveKeyCapture('ptm', 'Space', settings), {
    kind: 'bound',
    patch: { ptmKey: 'Space' },
  });
  assert.deepEqual(resolveKeyCapture('ptt', 'Escape', settings), { kind: 'cancelled' });

  const conflict = resolveKeyCapture('ptt', 'KeyN', settings);
  assert.equal(conflict.kind, 'conflict');
  assert.equal(
    conflict.kind === 'conflict' ? conflict.message : '',
    'That key is already push-to-mute. Pick another one.',
  );

  const reverse = resolveKeyCapture('ptm', 'KeyM', { ...settings, pttKey: 'KeyM' });
  assert.equal(reverse.kind, 'conflict');
});

test('key codes get short labels while storage keeps the raw code', () => {
  assert.equal(formatKeyCode(''), 'Unbound');
  assert.equal(formatKeyCode('Space'), 'Space');
  assert.equal(formatKeyCode('KeyM'), 'M');
  assert.equal(formatKeyCode('Digit7'), '7');
  assert.equal(formatKeyCode('Numpad4'), 'Num 4');
  assert.equal(formatKeyCode('ArrowUp'), 'Up arrow');
  assert.equal(formatKeyCode('ControlLeft'), 'Left Ctrl');
  assert.equal(formatKeyCode('F5'), 'F5');
  assert.equal(formatKeyCode('IntlBackslash'), 'IntlBackslash');
});
