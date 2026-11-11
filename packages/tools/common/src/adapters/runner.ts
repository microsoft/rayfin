import type { CancellationToken } from './cancellation.js';

/** Options for a single command invocation. */
export interface RunOptions {
  /** Working directory. Defaults to the host process cwd. */
  cwd?: string;
  /** Extra environment variables merged over the host environment. */
  env?: Record<string, string>;
  /** Cancellation token; the runner SHOULD terminate the child on cancel. */
  signal?: CancellationToken;
  /** Attach the child directly to the host process's standard streams. */
  inheritStdio?: boolean;
  /** Keep terminal input available while stdout and stderr remain piped. */
  inheritStdin?: boolean;
  /** Retain output in the result. Set false for long-running streamed output. */
  captureOutput?: boolean;
  /** Called with each stdout chunk as it streams. */
  onStdout?: (chunk: string) => void;
  /** Called with each stderr chunk as it streams. */
  onStderr?: (chunk: string) => void;
}

/** Outcome of a finished command. */
export interface RunResult {
  /**
   * Whether the process actually started. `false` means it never launched
   * (e.g. `ENOENT` / command not found, or a host with no local-process
   * capability). When `false`, `exitCode` is meaningless and `spawnError`
   * carries the reason.
   *
   * This distinguishes "the tool isn't installed" from "the tool ran and
   * failed" — very different remediation paths that both otherwise collapse
   * into a non-zero `exitCode`.
   */
  launched: boolean;
  /**
   * Reason the process failed to launch. Set only when `launched` is `false`
   * (e.g. `'docker: command not found'`). Undefined for a process that ran.
   */
  spawnError?: string;
  /**
   * Process exit code. `0` is success. Only meaningful when `launched` is
   * `true` and `cancelled` is falsy: a never-launched run leaves this
   * unspecified, and a cancelled run reports an unreliable value (a killed
   * child reports `null`, a signal-derived code such as `137`, etc.).
   * Callers MUST check `launched` and `cancelled` before treating a non-zero
   * `exitCode` as a failure.
   */
  exitCode: number;
  /**
   * `true` when the run was terminated via the `signal` in {@link RunOptions}
   * rather than exiting on its own. Distinguishes cancellation from genuine
   * failure so callers don't misclassify a cancelled run as an error.
   */
  cancelled?: boolean;
  /** Captured stdout; empty when capture is disabled or stdio is inherited. */
  stdout: string;
  /** Captured stderr; empty when capture is disabled or stdio is inherited. */
  stderr: string;
}

/**
 * CommandRunner adapter — shell / subprocess execution.
 *
 * Streams stdio and resolves with the exit code and captured output. Node
 * hosts back this with `child_process`. A host that cannot run local processes
 * resolves `{ launched: false, spawnError }` rather than throwing.
 */
export interface CommandRunner {
  run(
    command: string,
    args: string[],
    options?: RunOptions
  ): Promise<RunResult>;
}
