/**
 * Logger adapter — human-readable output lines.
 *
 * One real implementation per host (e.g. CLI → `console.*`), shared across
 * all commands on that host. Workflows render human-facing text exclusively
 * through this adapter; they never call `console.*` directly.
 *
 * `log` is the normal informational level; `warn` and `error` are the two
 * higher severities. Verbose detail is a separate concern handled by the
 * {@link Diagnostics} adapter.
 *
 * In `--output json` mode the host constructs a silent implementation so
 * the only thing written to stdout is the single JSON payload rendered by
 * Layer 1 from the workflow's `Result`.
 *
 * NOTE: This is also distinct from the legacy diagnostics `Logger` in
 * `common/src/logger.ts` (`info`/`warn`/`error`/`debug`), which is used by
 * telemetry and prereq checks. The two will be reconciled when those
 * surfaces migrate; until then they intentionally coexist under separate
 * subpaths (`_internal` vs `_internal/adapters`).
 */
export interface Logger {
  /** Write an informational line. */
  log(message: string): void;
  /** Write a warning line. */
  warn(message: string): void;
  /** Write an error line. */
  error(message: string): void;
}

/** A logger that silently discards all messages (test/JSON-mode default). */
export const silentLogger: Logger = {
  log() {},
  warn() {},
  error() {},
};
