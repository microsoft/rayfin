import { inspect } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from '../ApiClient';
import { AuthError, NetworkError } from '../errors';
import {
  FORBIDDEN_RESPONSE_TIMEOUT_MS,
  MAX_FORBIDDEN_RESPONSE_BYTES,
} from '../forbiddenResponse';

const code = 'ArtifactBlockedByAdmin';
const message =
  'This app has been blocked by your admin. Reach out to the app owner to get unblocked.';
const requestId = '44444444-4444-4444-4444-444444444444';
const secret = 'SYNTHETIC-PRIVATE-RESPONSE';

function body(
  details: unknown = [{ code: 'RootActivityId', message: requestId }]
) {
  return {
    code,
    httpStatusCode: 403,
    message: secret,
    details,
    accessToken: 'SYNTHETIC-ACCESS-TOKEN',
    refreshToken: 'SYNTHETIC-REFRESH-TOKEN',
    cookie: 'SYNTHETIC-COOKIE',
  };
}

function setup(response: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
  const onRefreshNeeded = vi.fn(async () => {});
  const onAuthExhausted = vi.fn();
  const client = new ApiClient({
    baseUrl: 'https://api.example.com',
    publishableKey: 'public-key',
    fetch,
    onRefreshNeeded,
    onAuthExhausted,
  });
  return { client, fetch, onRefreshNeeded, onAuthExhausted };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ApiClient administrator-block responses', () => {
  it.each([true, false])(
    'requires the transport status and root code, with optional status field %j',
    async (includeStatus) => {
      const logs = (['debug', 'error', 'info', 'log', 'warn'] as const).map(
        (method) => vi.spyOn(console, method).mockImplementation(() => {})
      );
      const value = includeStatus ? body() : { code, message: secret };
      const { client, fetch, onRefreshNeeded, onAuthExhausted } = setup(
        Response.json(value, { status: 403 })
      );

      const error = await client
        .post('/resource', {})
        .catch((error: unknown) => error);

      expect(error).toBeInstanceOf(NetworkError);
      expect(error).toMatchObject({ code, status: 403, message });
      if (includeStatus) {
        expect(error).toHaveProperty('requestId', requestId);
      } else {
        expect(error).not.toHaveProperty('requestId');
      }
      for (const field of [
        'body',
        'response',
        'details',
        'cause',
        'workload',
      ]) {
        expect(error).not.toHaveProperty(field, expect.anything());
      }
      const output = inspect([error, logs.flatMap((log) => log.mock.calls)], {
        depth: null,
      });
      for (const value of [
        secret,
        'SYNTHETIC-ACCESS-TOKEN',
        'SYNTHETIC-REFRESH-TOKEN',
        'SYNTHETIC-COOKIE',
      ]) {
        expect(output).not.toContain(value);
        expect(JSON.stringify(error)).not.toContain(value);
      }
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(onRefreshNeeded).not.toHaveBeenCalled();
      expect(onAuthExhausted).not.toHaveBeenCalled();
    }
  );

  it.each([
    null,
    [],
    'not an object',
    { error: { code } },
    { errorCode: code },
    { code: code.toLowerCase() },
    { code: `${code} ` },
    { code: 'SYNTHETIC_BLOCK' },
    { code, httpStatusCode: 401 },
    { code, httpStatusCode: '403' },
    { code, httpStatusCode: null },
    { code, httpStatusCode: false },
    {
      details: [
        {
          code: 'PowerBIApiErrorResponse',
          message: JSON.stringify({ error: { code } }),
        },
      ],
    },
  ])('does not classify an unsupported root shape %#', async (value) => {
    const { client, onRefreshNeeded } = setup(
      Response.json(value, { status: 403 })
    );
    const error = await client
      .get('/resource')
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toHaveProperty('status', 403);
    expect(error).not.toHaveProperty('code', code);
    expect(client.getResponseAuthError(error)).toBeUndefined();
    expect(onRefreshNeeded).not.toHaveBeenCalled();
  });

  it.each([400, 401, 404, 429, 500])(
    'does not classify the code under HTTP %i',
    async (status) => {
      const { client, fetch, onRefreshNeeded } = setup(
        Response.json(body(), { status })
      );
      const error = await client
        .get('/resource', { skipRetryOn401: true })
        .catch((error: unknown) => error);
      expect(error).toHaveProperty('status', status);
      expect(error).not.toHaveProperty('code', code);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(onRefreshNeeded).not.toHaveBeenCalled();
    }
  );

  it.each([
    undefined,
    null,
    {},
    [],
    [{ code: 'RequestId', message: requestId }],
    [{ code: 'rootactivityid', message: requestId }],
    [{ code: 'RootActivityId', message: `${requestId}\n` }],
    [{ code: 'RootActivityId', message: ` ${requestId}` }],
    [{ code: 'RootActivityId', message: secret }],
    [{ code: 'RootActivityId', message: { requestId } }],
    [
      {
        code: 'PowerBIApiErrorResponse',
        message: JSON.stringify({ requestId }),
      },
    ],
  ])('omits unrecognized correlation details %#', async (details) => {
    const { client } = setup(
      Response.json(
        { ...body(null), details, requestId },
        { status: 403, headers: { 'x-ms-request-id': requestId } }
      )
    );
    const error = await client
      .get('/resource')
      .catch((error: unknown) => error);
    expect(error).toMatchObject({ code, message });
    expect(error).not.toHaveProperty('requestId');
  });

  it('accepts only the GUID detail and ignores embedded JSON and unrelated fields', async () => {
    const { client } = setup(
      Response.json(
        body([
          {
            code: 'PowerBIApiErrorResponse',
            message: `invalid JSON ${secret}`,
          },
          { code: 'RootActivityId', message: secret },
          { code: 'RootActivityId', message: requestId, data: secret },
        ]),
        { status: 403 }
      )
    );
    const error = await client
      .get('/resource')
      .catch((error: unknown) => error);
    expect(error).toMatchObject({ code, message, requestId });
    expect(inspect(error)).not.toContain(secret);
  });

  it('does not inspect successful payloads for administrator-block diagnostics', async () => {
    const value = body();
    const response = Response.json(value);
    const json = vi.spyOn(response, 'json');
    const text = vi.spyOn(response, 'text');
    const clone = vi.spyOn(response, 'clone');
    const reader = vi.spyOn(response.body!, 'getReader');
    const { client } = setup(response);
    await expect(client.get('/resource')).resolves.toEqual(value);
    expect(text).toHaveBeenCalledExactlyOnceWith();
    expect(json).not.toHaveBeenCalled();
    expect(clone).not.toHaveBeenCalled();
    expect(reader).toHaveBeenCalledExactlyOnceWith();
  });

  it('maps only response errors using the original safe metadata across clients', async () => {
    const { client } = setup(Response.json(body(), { status: 403 }));
    const error = await client
      .get('/resource')
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(NetworkError);
    if (!(error instanceof NetworkError)) {
      throw new Error('Expected a response-produced NetworkError');
    }
    error.message = secret;
    error.code = 'SYNTHETIC_BLOCK';
    error.status = 401;
    const mapped = client.getResponseAuthError(error);
    expect(mapped).toBeInstanceOf(AuthError);
    expect(mapped).toMatchObject({ code, status: 403, message, requestId });
    const other = setup(Response.json({})).client;
    expect(other.getResponseAuthError(error)).toMatchObject({
      code,
      status: 403,
      message,
      requestId,
    });
    expect(
      client.getResponseAuthError(
        new NetworkError(secret, 403, code, requestId)
      )
    ).toBeUndefined();
    expect(
      client.getResponseAuthError(new AuthError(secret, code, 403, requestId))
    ).toBeUndefined();
  });

  it.each(['get', 'isolated'] as const)(
    'does not trust a fetch-thrown AuthError through %s',
    async (operation) => {
      const { client, fetch } = setup(Response.json({}));
      fetch.mockRejectedValue(new AuthError(secret, code, 403, requestId));
      const request =
        operation === 'get'
          ? client.get('/resource')
          : client.requestIsolated('/resource', {}, async () => undefined);
      const error = await request.catch((error: unknown) => error);
      expect(error).toBeInstanceOf(NetworkError);
      expect(error).not.toHaveProperty('code', code);
      expect(inspect(error)).not.toContain(secret);
      expect(client.getResponseAuthError(error)).toBeUndefined();
    }
  );

  it('does not trust an earlier response error replayed by custom fetch', async () => {
    const { client, fetch } = setup(Response.json(body(), { status: 403 }));
    const prior = await client
      .get('/resource')
      .catch((error: unknown) => error);
    fetch.mockRejectedValueOnce(prior);
    const replay = await client
      .get('/resource')
      .catch((error: unknown) => error);
    expect(replay).not.toBe(prior);
    expect(replay).not.toHaveProperty('code', code);
    expect(client.getResponseAuthError(replay)).toBeUndefined();
  });

  it.each([undefined, 'SYNTHETIC_BLOCK'])(
    'rejects a registered fetch error after its code was changed to %j',
    async (changedCode) => {
      const { client, fetch } = setup(Response.json(body(), { status: 403 }));
      const prior = await client
        .get('/resource')
        .catch((error: unknown) => error);
      if (!(prior instanceof NetworkError)) {
        throw new Error('Expected a response-produced NetworkError');
      }
      prior.code = changedCode;
      prior.message = secret;
      fetch.mockRejectedValueOnce(prior);

      const replay = await client
        .get('/resource')
        .catch((error: unknown) => error);

      expect(replay).not.toBe(prior);
      expect(replay).not.toHaveProperty('requestId');
      expect(client.getResponseAuthError(replay)).toBeUndefined();
      expect(String(replay)).not.toContain(secret);
    }
  );

  it.each(['configuration', 'setter'] as const)(
    'rejects a foreign historical response error thrown by a custom refresh %s',
    async (registration) => {
      const source = setup(Response.json(body(), { status: 403 }));
      const historical = await source.client
        .get('/source')
        .catch((error: unknown) => error);
      expect(historical).toMatchObject({ code, requestId });
      const { client, fetch, onRefreshNeeded, onAuthExhausted } = setup(
        new Response(null, { status: 401 })
      );
      if (registration === 'setter') {
        client.setRefreshCallback(onRefreshNeeded);
      }
      onRefreshNeeded.mockRejectedValueOnce(historical);

      const error = await client
        .get('/resource')
        .catch((error: unknown) => error);

      expect(error).not.toBe(historical);
      expect(error).not.toHaveProperty('code', code);
      expect(error).not.toHaveProperty('requestId');
      expect(client.getResponseAuthError(error)).toBeUndefined();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(onRefreshNeeded).toHaveBeenCalledTimes(1);
      expect(onAuthExhausted).not.toHaveBeenCalled();
    }
  );

  it('does not trust a caller refresh callback that throws the reserved code', async () => {
    const { client, fetch, onRefreshNeeded, onAuthExhausted } = setup(
      new Response(null, { status: 401 })
    );
    onRefreshNeeded.mockRejectedValueOnce(
      new AuthError(secret, code, 403, requestId)
    );
    const error = await client
      .get('/resource')
      .catch((error: unknown) => error);
    expect(error).not.toHaveProperty('code', code);
    expect(error).not.toHaveProperty('requestId');
    expect(String(error)).not.toContain(secret);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onRefreshNeeded).toHaveBeenCalledTimes(1);
    expect(onAuthExhausted).not.toHaveBeenCalled();
  });
});

describe('ApiClient bounded forbidden response reads', () => {
  it.each([0, 1])(
    'enforces the exact byte limit with %i extra bytes',
    async (extra) => {
      const value = JSON.stringify({ code });
      const raw = value.padEnd(MAX_FORBIDDEN_RESPONSE_BYTES + extra, ' ');
      const { client } = setup(
        new Response(raw, {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      const error = await client
        .get('/resource')
        .catch((error: unknown) => error);
      expect(error).toHaveProperty('status', 403);
      expect(error).toHaveProperty('code', extra === 0 ? code : undefined);
    }
  );

  it.each([
    { contentType: 'text/plain' },
    { contentType: 'text/html' },
    {
      contentType: 'application/json',
      contentLength: String(MAX_FORBIDDEN_RESPONSE_BYTES + 1),
    },
  ])(
    'cancels before pulling when headers rule out bounded JSON %#',
    async ({ contentType, contentLength }) => {
      const pull = vi.fn();
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>(
        { pull, cancel },
        { highWaterMark: 0 }
      );
      const headers = new Headers({ 'Content-Type': contentType });
      if (contentLength) {
        headers.set('Content-Length', contentLength);
      }
      const { client } = setup(new Response(stream, { status: 403, headers }));
      await expect(client.get('/resource')).rejects.toMatchObject({
        status: 403,
        code: undefined,
      });
      expect(pull).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledTimes(1);
    }
  );

  it('limits streamed UTF-8 bytes rather than decoded characters', async () => {
    const chunk = new TextEncoder().encode(
      `{"code":"${code}","padding":"${'\u00e9'.repeat(MAX_FORBIDDEN_RESPONSE_BYTES / 2)}"}`
    );
    const pull = vi.fn();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pull();
          controller.enqueue(chunk);
        },
        cancel,
      },
      { highWaterMark: 0 }
    );
    const { client } = setup(
      new Response(stream, {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await expect(client.get('/resource')).rejects.toMatchObject({
      status: 403,
      code: undefined,
    });
    expect(pull).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });

  it('bounds endlessly empty chunks that would otherwise starve the read timer', async () => {
    let pulls = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++;
          controller.enqueue(new Uint8Array());
        },
        cancel,
      },
      { highWaterMark: 0 }
    );
    const { client } = setup(
      new Response(stream, {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await expect(client.get('/resource')).rejects.toMatchObject({
      status: 403,
      code: undefined,
    });
    expect(pulls).toBeLessThanOrEqual(MAX_FORBIDDEN_RESPONSE_BYTES + 1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });

  it.each([false, true])(
    'bounds a stalled read even if cancellation hangs: %j',
    async (hangCancel) => {
      vi.useFakeTimers();
      const cancel = vi.fn(() =>
        hangCancel ? new Promise<void>(() => {}) : undefined
      );
      const stream = new ReadableStream<Uint8Array>(
        { cancel },
        { highWaterMark: 0 }
      );
      const { client } = setup(
        new Response(stream, {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      const settled = vi.fn();
      const result = client.get('/resource').catch((error: unknown) => {
        settled();
        return error;
      });
      await vi.advanceTimersByTimeAsync(FORBIDDEN_RESPONSE_TIMEOUT_MS - 1);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toMatchObject({ status: 403, code: undefined });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(stream.locked).toBe(false);
    }
  );

  it('cancels a pending read when the request signal aborts', async () => {
    const cancel = vi.fn();
    const pull = vi.fn();
    const stream = new ReadableStream<Uint8Array>(
      { pull, cancel },
      { highWaterMark: 0 }
    );
    const { client } = setup(
      new Response(stream, {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const controller = new AbortController();
    const result = client
      .get('/resource', { signal: controller.signal })
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(pull).toHaveBeenCalled());
    controller.abort(new Error(secret));
    expect(await result).toMatchObject({ status: 403, code: undefined });
    expect(inspect(await result)).not.toContain(secret);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('honors a shorter request timeout while reading the 403 body', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const { client } = setup(
      new Response(
        new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const result = client
      .get('/resource', { timeout: 25 })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toMatchObject({ status: 403, code: undefined });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sanitizes stream failures without service attribution', async () => {
    const pull = vi.fn(() => {
      throw new Error(secret);
    });
    const { client } = setup(
      new Response(
        new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const result = await client
      .get('/resource')
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ status: 403, code: undefined });
    expect(inspect(result)).not.toContain(secret);
    expect(result).not.toHaveProperty('cause');
  });

  it('sanitizes an unread-body cancellation failure without service attribution', async () => {
    const pull = vi.fn();
    const cancel = vi.fn().mockRejectedValue(new Error(secret));
    const { client } = setup(
      new Response(
        new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 }),
        { status: 403, headers: { 'Content-Type': 'text/plain' } }
      )
    );
    const result = await client
      .get('/resource')
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ status: 403, code: undefined });
    expect(inspect(result)).not.toContain(secret);
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty('cause');
  });

  it.each(['', '{"code":', '<html>not JSON</html>'])(
    'keeps malformed JSON as an ordinary 403: %j',
    async (raw) => {
      const { client } = setup(
        new Response(raw, {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      await expect(client.get('/resource')).rejects.toMatchObject({
        status: 403,
        code: undefined,
      });
    }
  );
});
