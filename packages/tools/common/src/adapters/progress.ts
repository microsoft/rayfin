/**
 * A single progress update emitted by a workflow step.
 *
 * Push-style: the workflow calls `report` as it advances; the host decides
 * how to render (ora spinner, plain stderr line, or silence in `--output json`).
 */
export interface ProgressUpdate {
  /** Coarse phase label, e.g. `'deploy'` or `'apply-db'`. */
  phase?: string;
  /** Human-readable detail for the current phase. */
  message?: string;
  /** Completion fraction in the range [0, 100], when known. */
  percent?: number;
}

/**
 * Progress adapter — phase + percent reporting.
 *
 * Push-style: the workflow calls `report` as it advances and the host renders
 * (or silences) the update.
 *
 * Cancellation is a **separate** concern: a workflow that needs to honor
 * cancellation declares `CancellationToken` directly in its `Deps`
 * rather than reaching it through `Progress`. This keeps reporting and
 * cancellation independent (ISP) — a step that reports progress but never
 * cancels, or cancels but reports nothing, depends on only what it uses.
 */
export interface Progress {
  /** Report a progress update. Never throws; rendering is best-effort. */
  report(update: ProgressUpdate): void;
}
