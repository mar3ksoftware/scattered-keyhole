// ── Push-to-talk / push-to-mute controller (roadmap 8c) ───────────────
// Pure keyboard state machine: no DOM listeners here, so the 1:1 call layer
// can feed it `event.code` values from a focused-tab listener and tests can
// drive it directly. Browsers only deliver key events to the focused tab,
// which is the documented platform limit for PTT/PTM on the web.

export type PttMode = 'off' | 'ptt' | 'ptm';

export type PttSnapshot = {
  readonly mode: PttMode;
  readonly muted: boolean;
  readonly held: boolean;
};

export type PttControllerOptions = {
  readonly pttKey: string;
  readonly ptmKey: string;
  // Baseline set by the mic toggle button; PTT/PTM can only add mute.
  readonly manualMuted?: boolean;
  readonly onChange?: (snapshot: PttSnapshot) => void;
};

export type PttController = {
  readonly snapshot: () => PttSnapshot;
  // Both return true when the code belonged to this controller, so the DOM
  // layer knows whether to preventDefault (Space would scroll the page).
  readonly keyDown: (code: string, repeat?: boolean) => boolean;
  readonly keyUp: (code: string) => boolean;
  readonly setManualMuted: (muted: boolean) => void;
  readonly toggleManualMuted: () => void;
  readonly setBindings: (pttKey: string, ptmKey: string) => void;
  // Window blur / call teardown: a held key must never leave the mic open.
  readonly releaseAll: () => void;
};

function modeOf(pttKey: string, ptmKey: string): PttMode {
  if (pttKey.length > 0) return 'ptt';
  if (ptmKey.length > 0) return 'ptm';
  return 'off';
}

export function createPttController(options: PttControllerOptions): PttController {
  let pttKey = options.pttKey;
  let ptmKey = options.ptmKey;
  let manualMuted = options.manualMuted === true;
  let held = false;
  let last: PttSnapshot | null = null;

  const current = (): PttSnapshot => {
    const mode = modeOf(pttKey, ptmKey);
    const muted = manualMuted || (mode === 'ptt' && !held) || (mode === 'ptm' && held);
    return { mode, muted, held };
  };

  const emit = (): void => {
    const next = current();
    if (
      last !== null &&
      last.mode === next.mode &&
      last.muted === next.muted &&
      last.held === next.held
    ) {
      return;
    }
    last = next;
    options.onChange?.(next);
  };

  // Seed the snapshot so the call layer can apply the initial mute state
  // without waiting for the first key press.
  last = current();

  return {
    snapshot: current,
    keyDown(code, repeat = false) {
      if (repeat) return false;
      const mode = modeOf(pttKey, ptmKey);
      if (mode === 'off' || code !== (mode === 'ptt' ? pttKey : ptmKey)) return false;
      held = true;
      emit();
      return true;
    },
    keyUp(code) {
      const mode = modeOf(pttKey, ptmKey);
      if (mode === 'off' || code !== (mode === 'ptt' ? pttKey : ptmKey)) return false;
      held = false;
      emit();
      return true;
    },
    setManualMuted(muted) {
      manualMuted = muted;
      emit();
    },
    toggleManualMuted() {
      manualMuted = !manualMuted;
      emit();
    },
    setBindings(nextPttKey, nextPtmKey) {
      pttKey = nextPttKey;
      ptmKey = nextPtmKey;
      // A rebind drops any held state: the old key no longer owns the mic.
      held = false;
      emit();
    },
    releaseAll() {
      held = false;
      emit();
    },
  };
}

type TypingTarget = {
  readonly tagName?: unknown;
  readonly isContentEditable?: unknown;
};

// Keys pressed while composing text must never reach PTT/PTM.
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null) return false;
  const element = target as TypingTarget;
  if (typeof element.tagName !== 'string') return false;
  const tag = element.tagName.toUpperCase();
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true
  );
}
