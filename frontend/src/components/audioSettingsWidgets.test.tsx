import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AUDIO_SETTINGS_STORAGE_KEY,
  type AudioSettings,
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  saveAudioSettings,
} from '../lib/audioSettings';
import { type AudioDeviceOption, AudioSettingsForm } from './AudioSettingsPanel';
import { CallMuteButton } from './CallMuteButton';

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const INPUTS: readonly AudioDeviceOption[] = [
  { deviceId: 'mic-1', label: 'Studio mic' },
  { deviceId: 'mic-2', label: '' },
];
const OUTPUTS: readonly AudioDeviceOption[] = [{ deviceId: 'spk-1', label: 'Desk speakers' }];

function renderForm(
  settings: AudioSettings,
  overrides: Partial<Parameters<typeof AudioSettingsForm>[0]> = {},
): string {
  return render(
    <AudioSettingsForm
      settings={settings}
      onChange={() => {}}
      inputs={INPUTS}
      outputs={OUTPUTS}
      capturing={null}
      onCapture={() => {}}
      conflict={null}
      onRefreshDevices={() => {}}
      onRequestLabels={() => {}}
      {...overrides}
    />,
  );
}

test('audio panel renders the documented defaults', () => {
  const html = renderForm(DEFAULT_AUDIO_SETTINGS);
  assert.ok(html.includes('Voice'));
  assert.ok(html.includes('Music'));
  assert.ok(html.includes('32 kbps'));
  assert.ok(html.includes('128 kbps'));
  assert.ok(html.includes('Echo cancellation'));
  assert.ok(html.includes('Noise suppression'));
  assert.ok(html.includes('Automatic gain control'));
  // One checked radio (voice) plus three checked DSP boxes.
  assert.equal(count(html, 'checked=""'), 4);
  // Both bindings start unbound and offer a Clear entry.
  assert.equal(count(html, '>Unbound<'), 2);
  assert.equal(count(html, '>Clear<'), 2);
  assert.ok(html.includes('Push to talk'));
  assert.ok(html.includes('Push to mute'));
});

test('audio panel renders the settings persisted in localStorage', () => {
  const data: Record<string, string> = {};
  const storage = {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
  const persisted: AudioSettings = {
    ...DEFAULT_AUDIO_SETTINGS,
    bitrate: 'music',
    noiseSuppression: false,
  };
  assert.equal(saveAudioSettings(persisted, storage), true);
  assert.ok(data[AUDIO_SETTINGS_STORAGE_KEY]?.includes('"bitrate":"music"'));

  const loaded = loadAudioSettings(storage);
  const html = renderForm(loaded);
  assert.ok(html.includes('value="music"'));
  // Music radio + echo cancellation + auto gain; noise suppression is off.
  assert.equal(count(html, 'checked=""'), 3);
});

test('audio panel lists the enumerated devices with a default entry', () => {
  const html = renderForm(DEFAULT_AUDIO_SETTINGS);
  assert.ok(html.includes('Studio mic'));
  assert.ok(html.includes('Microphone 2'), 'unlabelled inputs get a positional fallback');
  assert.ok(html.includes('Desk speakers'));
  assert.ok(html.includes('System default'));
  assert.ok(html.includes('Allow device names'));
});

test('a capturing row asks for a key press', () => {
  const html = renderForm(DEFAULT_AUDIO_SETTINGS, { capturing: 'ptt' });
  assert.ok(html.includes('Press a key…'));
  assert.ok(html.includes('Push to talk key: press a key'));
});

test('duplicate bindings surface an inline warning', () => {
  const html = renderForm({ ...DEFAULT_AUDIO_SETTINGS, pttKey: 'KeyM', ptmKey: 'KeyM' });
  assert.ok(html.includes('Push-to-talk and push-to-mute cannot share a key.'));
});

test('a refused capture surfaces the conflict message', () => {
  const html = renderForm(
    { ...DEFAULT_AUDIO_SETTINGS, pttKey: 'Space' },
    { conflict: 'That key is already push-to-talk. Pick another one.' },
  );
  assert.ok(html.includes('That key is already push-to-talk. Pick another one.'));
});

test('the call mute button reports muted and live states', () => {
  const muted = render(<CallMuteButton muted onToggle={() => {}} />);
  assert.ok(muted.includes('data-key="mute-toggle"'));
  assert.ok(muted.includes('aria-pressed="true"'));
  assert.ok(muted.includes('Microphone muted'));
  assert.ok(muted.includes('Unmute mic'));

  const live = render(<CallMuteButton muted={false} onToggle={() => {}} />);
  assert.ok(live.includes('aria-pressed="false"'));
  assert.ok(live.includes('Microphone live'));
  assert.ok(live.includes('Mute mic'));
});
