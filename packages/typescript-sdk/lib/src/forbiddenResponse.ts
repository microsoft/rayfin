/** @internal Shared administrator-block code for SDK error boundaries. */
export const ARTIFACT_BLOCKED_CODE = 'ArtifactBlockedByAdmin';
/** @internal Fixed consumer message for SDK administrator-block errors. */
export const ARTIFACT_BLOCKED_MESSAGE =
  'This app has been blocked by your admin. Reach out to the app owner to get unblocked.';

export const MAX_FORBIDDEN_RESPONSE_BYTES = 16 * 1024;
export const FORBIDDEN_RESPONSE_TIMEOUT_MS = 1000;

export interface ArtifactBlockDetails {
  readonly requestId?: string;
}

export function artifactBlockDetails(
  value: unknown
): ArtifactBlockDetails | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('code' in value) ||
    value.code !== ARTIFACT_BLOCKED_CODE ||
    ('httpStatusCode' in value && value.httpStatusCode !== 403)
  ) {
    return undefined;
  }

  if ('details' in value && Array.isArray(value.details)) {
    const details: unknown[] = value.details;
    for (const detail of details) {
      if (
        detail &&
        typeof detail === 'object' &&
        !Array.isArray(detail) &&
        'code' in detail &&
        detail.code === 'RootActivityId' &&
        'message' in detail &&
        typeof detail.message === 'string' &&
        detail.message.length === 36 &&
        /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(detail.message)
      ) {
        return { requestId: detail.message };
      }
    }
  }
  return {};
}

/** @internal Recognizes only a bounded canonical administrator-block HTTP response. */
export async function isArtifactBlockedResponse(
  response: Response
): Promise<boolean> {
  if (response.ok || response.status !== 403 || response.redirected) {
    return false;
  }
  try {
    const value = await readForbiddenResponse(
      response,
      new AbortController().signal
    );
    return artifactBlockDetails(value) !== undefined;
  } catch {
    // Unavailable diagnostics must not replace the original HTTP failure.
    return false;
  }
}

export async function readForbiddenResponse(
  response: Response,
  signal: AbortSignal
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) {
    return undefined;
  }

  let stop!: () => void;
  let stopped = false;
  let finished = false;
  const interrupted = new Promise<undefined>((resolve) => {
    stop = () => {
      stopped = true;
      resolve(undefined);
    };
  });
  const timer = setTimeout(stop, FORBIDDEN_RESPONSE_TIMEOUT_MS);
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) {
    stop();
  }

  const read = async (): Promise<unknown> => {
    const contentType = response.headers
      .get('Content-Type')
      ?.split(';')[0]
      .trim()
      .toLowerCase();
    const contentLength = response.headers.get('Content-Length');
    if (
      stopped ||
      !contentType ||
      !/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/.test(contentType) ||
      (contentLength !== null &&
        /^\d+$/.test(contentLength) &&
        Number(contentLength) > MAX_FORBIDDEN_RESPONSE_BYTES)
    ) {
      return undefined;
    }

    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0;
    let reads = 0;
    let text = '';
    // Empty chunks must not keep the microtask queue busy past the deadline.
    while (!stopped && reads++ <= MAX_FORBIDDEN_RESPONSE_BYTES) {
      const chunk = await reader.read();
      if (stopped) {
        return undefined;
      }
      if (chunk.done) {
        finished = true;
        return JSON.parse(text + decoder.decode()) as unknown;
      }
      size += chunk.value.byteLength;
      if (size > MAX_FORBIDDEN_RESPONSE_BYTES) {
        return undefined;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return undefined;
  };

  let value: unknown;
  try {
    value = await Promise.race([read(), interrupted]);
  } catch {
    // Unreadable diagnostics retain the original HTTP failure, not their cause.
    value = undefined;
  } finally {
    if (!finished) {
      try {
        await Promise.race([reader.cancel(), interrupted]);
      } catch {
        value = undefined;
      }
    }
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
    reader.releaseLock();
  }
  return value;
}
