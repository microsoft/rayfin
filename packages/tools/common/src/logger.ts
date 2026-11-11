/**
 * Platform-agnostic logging abstraction.
 *
 * Consumers inject implementations appropriate to their environment:
 * - CLI: writes to stdout/stderr
 * - Tests: no-op or captured
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

/** A logger that silently discards all messages. */
export const noopLogger: Logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};
