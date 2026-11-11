/**
 * Minimal cancellation primitive for universal (web-safe) code.
 *
 * Workflows honor cancellation between steps via a token in their dependencies.
 * Hosts can supply this interface directly or use an `AbortSignal`-backed shim
 * without the shared layer importing Node built-ins.
 */
export interface CancellationToken {
  /** Whether cancellation has already been requested. */
  readonly isCancellationRequested: boolean;

  /**
   * Subscribe to the cancellation event. Returns a disposable; call
   * `dispose()` to unsubscribe.
   */
  onCancellationRequested(listener: () => void): { dispose(): void };
}

/** A cancellation token that is never cancelled. */
export const noopCancellationToken: CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested() {
    return { dispose() {} };
  },
};

/** A {@link CancellationToken} the creator can also cancel directly. */
export interface LinkedCancellation {
  /** The derived token to hand to callees. */
  readonly token: CancellationToken;
  /** Cancel the derived token without touching `parent`. */
  cancel(): void;
  /** Stop observing `parent` and drop all subscribers. */
  dispose(): void;
}

/**
 * Derive a cancellation token that fires when `parent` fires **or** when the
 * creator calls `cancel()`.
 *
 * Lets a step abort work it owns (e.g. stopping sibling processes after a
 * required one dies) without cancelling the caller's token, which the caller
 * still needs to distinguish "the user pressed Ctrl-C" from "we gave up".
 */
export function createLinkedCancellation(
  parent?: CancellationToken
): LinkedCancellation {
  const listeners = new Set<() => void>();
  let requested = parent?.isCancellationRequested === true;

  const fire = (): void => {
    if (requested) return;
    requested = true;
    for (const listener of [...listeners]) listener();
  };

  const subscription = parent?.onCancellationRequested(fire);

  return {
    token: {
      get isCancellationRequested() {
        return requested;
      },
      onCancellationRequested(listener: () => void) {
        if (requested) {
          void Promise.resolve().then(listener);
          return { dispose() {} };
        }
        listeners.add(listener);
        return {
          dispose() {
            listeners.delete(listener);
          },
        };
      },
    },
    cancel: fire,
    dispose() {
      subscription?.dispose();
      listeners.clear();
    },
  };
}

/**
 * Adapt a web-platform `AbortSignal` into a {@link CancellationToken}.
 *
 * Lets Node and browser hosts that already model cancellation with
 * `AbortController` satisfy the workflow contract.
 */
export function cancellationTokenFromSignal(
  signal: AbortSignal
): CancellationToken {
  return {
    get isCancellationRequested() {
      return signal.aborted;
    },
    onCancellationRequested(listener: () => void) {
      if (signal.aborted) {
        // Already aborted: schedule the listener on the next microtask so
        // subscribers always observe cancellation asynchronously, matching
        // the emitter-based hosts. The returned disposable is intentionally
        // inert — the listener is already scheduled and cannot be unsubscribed,
        // so a host that disposes eagerly in this path still sees the callback
        // fire. This is the correct one-shot-cancellation semantics.
        void Promise.resolve().then(listener);
        return { dispose() {} };
      }
      signal.addEventListener('abort', listener, { once: true });
      return {
        dispose() {
          signal.removeEventListener('abort', listener);
        },
      };
    },
  };
}

/** An abort signal derived from a {@link CancellationToken}. */
export interface CancellationAbortSignal {
  /** Signal to pass to web APIs such as `fetch`. */
  readonly signal: AbortSignal;
  /** Stop observing the source token. */
  dispose(): void;
}

/**
 * Adapt a {@link CancellationToken} into a web-platform `AbortSignal`.
 *
 * The caller owns the returned subscription and must dispose it after the
 * operation completes.
 */
export function abortSignalFromCancellationToken(
  token: CancellationToken
): CancellationAbortSignal {
  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
    return { signal: controller.signal, dispose() {} };
  }

  const subscription = token.onCancellationRequested(() => controller.abort());
  return {
    signal: controller.signal,
    dispose() {
      subscription.dispose();
    },
  };
}
