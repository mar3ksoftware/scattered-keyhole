// ── Optimistic operations awaiting a possible rejection ──
// message_rejected carries no correlation id, so rollbacks are matched
// newest-first within a short window — the rejection lands within one
// round-trip of its emit, making the most recent op almost always the one
// being rejected. Extracted from ChatContext so the matching rules are
// testable with a fake clock.

const DEFAULT_TTL_MS = 5_000;

export type PendingOps = {
  // Queue the undo for an optimistic apply.
  readonly enqueue: (undo: () => void) => void;
  // Run the newest still-fresh undo (the message_rejected path).
  readonly runLatest: () => void;
  // Drop everything (logout / socket teardown).
  readonly clear: () => void;
};

export function createPendingOps(
  ttlMs: number = DEFAULT_TTL_MS,
  now: () => number = Date.now,
): PendingOps {
  let ops: { readonly at: number; readonly undo: () => void }[] = [];

  const fresh = () => {
    const at = now();
    ops = ops.filter((op) => at - op.at <= ttlMs);
  };

  return {
    enqueue: (undo) => {
      fresh();
      ops.push({ at: now(), undo });
    },
    runLatest: () => {
      fresh();
      const op = ops.pop();
      if (op !== undefined) op.undo();
    },
    clear: () => {
      ops = [];
    },
  };
}
