import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AUDIO_BITRATE_BPS,
  type AudioSettings,
  formatKeyCode,
  isDuplicateKeyBinding,
  resolveKeyCapture,
} from '../lib/audioSettings';

type KeyTarget = 'ptt' | 'ptm';

export type AudioDeviceOption = {
  readonly deviceId: string;
  readonly label: string;
};

export type AudioSettingsFormProps = {
  readonly settings: AudioSettings;
  readonly onChange: (patch: Partial<AudioSettings>) => void;
  readonly inputs: readonly AudioDeviceOption[];
  readonly outputs: readonly AudioDeviceOption[];
  // Which binding row is waiting for a key press; null when idle.
  readonly capturing: KeyTarget | null;
  readonly onCapture: (target: KeyTarget | null) => void;
  // Refused binding (the key already belongs to the other action).
  readonly conflict: string | null;
  readonly onRefreshDevices?: (() => void) | undefined;
  readonly onRequestLabels?: (() => void) | undefined;
};

const KEY_ROW_CLASS =
  'rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700/50';

function DeviceSelect({
  id,
  label,
  value,
  options,
  fallbackLabel,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string | null;
  readonly options: readonly AudioDeviceOption[];
  readonly fallbackLabel: string;
  readonly onChange: (deviceId: string | null) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm text-zinc-400" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        className="w-full rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
      >
        <option value="">System default</option>
        {options.map((option, index) => (
          <option key={option.deviceId} value={option.deviceId}>
            {option.label.length > 0 ? option.label : `${fallbackLabel} ${index + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}

function KeyBindingRow({
  label,
  description,
  keyCode,
  capturing,
  onCapture,
  onClear,
}: {
  readonly label: string;
  readonly description: string;
  readonly keyCode: string;
  readonly capturing: boolean;
  readonly onCapture: () => void;
  readonly onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-zinc-200">{label}</p>
        <p className="text-xs text-zinc-500">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onCapture}
          aria-label={`${label} key: ${capturing ? 'press a key' : formatKeyCode(keyCode)}`}
          className={`${KEY_ROW_CLASS} ${capturing ? 'border-indigo-400/60 text-indigo-300' : ''}`}
        >
          {capturing ? 'Press a key…' : formatKeyCode(keyCode)}
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={keyCode.length === 0}
          className="text-xs text-zinc-500 transition-colors hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

// Presentational half of the panel: no browser APIs, so widget tests can
// render it through react-dom/server like the other forms in this app.
export function AudioSettingsForm({
  settings,
  onChange,
  inputs,
  outputs,
  capturing,
  onCapture,
  conflict,
  onRefreshDevices,
  onRequestLabels,
}: AudioSettingsFormProps) {
  const duplicate = isDuplicateKeyBinding(settings.pttKey, settings.ptmKey);

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-zinc-300">Call quality</legend>
        <div className="space-y-2">
          {(['voice', 'music'] as const).map((bitrate) => (
            <label
              key={bitrate}
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-3 py-2"
            >
              <input
                type="radio"
                name="audio-bitrate"
                value={bitrate}
                checked={settings.bitrate === bitrate}
                onChange={() => onChange({ bitrate })}
                className="mt-0.5 accent-indigo-500"
              />
              <span>
                <span className="block text-sm text-zinc-200">
                  {bitrate === 'voice' ? 'Voice' : 'Music'}
                </span>
                <span className="block text-xs text-zinc-500">
                  {bitrate === 'voice'
                    ? `Opus ${AUDIO_BITRATE_BPS.voice / 1000} kbps, mono — tuned for speech`
                    : `Opus ${AUDIO_BITRATE_BPS.music / 1000} kbps, stereo when the device allows`}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-zinc-300">Audio processing</legend>
        <div className="space-y-2">
          {(
            [
              ['echoCancellation', 'Echo cancellation', 'Removes the speaker echo from your mic.'],
              ['noiseSuppression', 'Noise suppression', 'Dampens fans and background hum.'],
              ['autoGainControl', 'Automatic gain control', 'Keeps your level steady as you move.'],
            ] as const
          ).map(([field, label, description]) => (
            <label key={field} className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={settings[field]}
                onChange={(event) => onChange({ [field]: event.target.checked })}
                className="mt-0.5 accent-indigo-500"
              />
              <span>
                <span className="block text-sm text-zinc-200">{label}</span>
                <span className="block text-xs text-zinc-500">{description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-zinc-300">Devices</legend>
        <div className="space-y-3">
          <DeviceSelect
            id="audio-input-device"
            label="Microphone"
            value={settings.inputDeviceId}
            options={inputs}
            fallbackLabel="Microphone"
            onChange={(deviceId) => onChange({ inputDeviceId: deviceId })}
          />
          <DeviceSelect
            id="audio-output-device"
            label="Speaker"
            value={settings.outputDeviceId}
            options={outputs}
            fallbackLabel="Speaker"
            onChange={(deviceId) => onChange({ outputDeviceId: deviceId })}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {onRefreshDevices !== undefined && (
            <button
              type="button"
              onClick={onRefreshDevices}
              className="text-xs text-zinc-400 transition-colors hover:text-zinc-200"
            >
              Refresh list
            </button>
          )}
          {onRequestLabels !== undefined && (
            <button
              type="button"
              onClick={onRequestLabels}
              className="text-xs text-zinc-400 transition-colors hover:text-zinc-200"
            >
              Allow device names
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Device names appear after the browser grants microphone access.
        </p>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-zinc-300">Push to talk</legend>
        <div className="space-y-3">
          <KeyBindingRow
            label="Push to talk"
            description="Hold to open the mic, release to mute."
            keyCode={settings.pttKey}
            capturing={capturing === 'ptt'}
            onCapture={() => onCapture(capturing === 'ptt' ? null : 'ptt')}
            onClear={() => onChange({ pttKey: '' })}
          />
          <KeyBindingRow
            label="Push to mute"
            description="Hold to mute the mic, release to open it."
            keyCode={settings.ptmKey}
            capturing={capturing === 'ptm'}
            onCapture={() => onCapture(capturing === 'ptm' ? null : 'ptm')}
            onClear={() => onChange({ ptmKey: '' })}
          />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Keys only work while this tab has focus — a browser limit. Leave both unbound to use the
          mic button only.
        </p>
        {conflict !== null && (
          <p role="alert" className="mt-2 text-xs text-amber-400">
            {conflict}
          </p>
        )}
        {duplicate && (
          <p role="alert" className="mt-2 text-xs text-amber-400">
            Push-to-talk and push-to-mute cannot share a key.
          </p>
        )}
      </fieldset>
    </div>
  );
}

type AudioSettingsPanelProps = {
  readonly isOpen: boolean;
  readonly settings: AudioSettings;
  readonly onChange: (patch: Partial<AudioSettings>) => void;
  readonly onClose: () => void;
};

function toOptions(
  devices: readonly MediaDeviceInfo[],
  fallbackLabel: string,
): AudioDeviceOption[] {
  return devices.map((device, index) => ({
    deviceId: device.deviceId,
    label: device.label.length > 0 ? device.label : `${fallbackLabel} ${index + 1}`,
  }));
}

export function AudioSettingsPanel({
  isOpen,
  settings,
  onChange,
  onClose,
}: AudioSettingsPanelProps) {
  const [inputs, setInputs] = useState<readonly AudioDeviceOption[]>([]);
  const [outputs, setOutputs] = useState<readonly AudioDeviceOption[]>([]);
  const [capturing, setCapturing] = useState<KeyTarget | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || navigator.mediaDevices === undefined) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setInputs(
        toOptions(
          devices.filter((d) => d.kind === 'audioinput'),
          'Microphone',
        ),
      );
      setOutputs(
        toOptions(
          devices.filter((d) => d.kind === 'audiooutput'),
          'Speaker',
        ),
      );
    } catch {
      // Enumeration can fail without permission; the defaults stay usable.
    }
  }, []);

  // Labels are only populated once the page holds mic permission, so this is
  // an explicit action rather than something that fires on open.
  const requestLabels = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
    } catch {
      return;
    }
    await refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    if (!isOpen) return;
    void refreshDevices();
    const onDeviceChange = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
  }, [isOpen, refreshDevices]);

  // Key capture: capture phase plus stopPropagation keeps the live PTT
  // listener from seeing the key that is being bound.
  useEffect(() => {
    if (capturing === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      const result = resolveKeyCapture(capturing, event.code, settings);
      if (result.kind === 'cancelled') {
        setCapturing(null);
        setConflict(null);
        return;
      }
      if (result.kind === 'conflict') {
        setConflict(result.message);
        setCapturing(null);
        return;
      }
      onChange(result.patch);
      setConflict(null);
      setCapturing(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturing, onChange, settings]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && capturing === null) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, capturing, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="audio-settings-title"
        className="glass flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-zinc-700/50"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800/60 px-6 py-4">
          <h2 id="audio-settings-title" className="text-lg font-semibold text-zinc-100">
            Audio settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-zinc-400 transition-colors hover:text-zinc-200"
          >
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <AudioSettingsForm
            settings={settings}
            onChange={onChange}
            inputs={inputs}
            outputs={outputs}
            capturing={capturing}
            onCapture={setCapturing}
            conflict={conflict}
            onRefreshDevices={() => void refreshDevices()}
            onRequestLabels={() => void requestLabels()}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
