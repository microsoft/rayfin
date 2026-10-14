import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmbedHostError } from '../errors';
import { createExternalEntraHandoffProvider } from '../handoffProvider';
import type { HandoffRequest } from '../types';

const request: HandoffRequest = {
  brokeredAuthorizeUrl:
    'https://cap.pbidedicated.windows.net/api/auth/v1/brokered/authorize/external',
  artifactId: 'artifact-1',
  returnOrigin: 'https://app.example.com',
  codeChallenge: 'challenge',
  codeChallengeMethod: 'S256',
  state: 'state-1',
  getAccessToken: () => 'secret-token',
};

const blockedCode = 'ArtifactBlockedByAdmin';
const blockedMessage =
  'This app has been blocked by your admin. Reach out to the app owner to get unblocked.';
const privateText = 'SYNTHETIC-PRIVATE-BACKEND-TEXT';

function mockFetch(
  response: Partial<Response> & { json?: () => Promise<unknown> }
) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response as Response);
}

describe('external-Entra handoff provider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('posts the token, moniker, and PKCE body and returns the code', async () => {
    const fetchSpy = mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ handoffCode: 'code-1', state: 'state-1' }),
    });
    const result = await createExternalEntraHandoffProvider().acquire(request);
    expect(result).toEqual({ handoffCode: 'code-1', state: 'state-1' });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(request.brokeredAuthorizeUrl);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer secret-token');
    expect(headers['x-ms-workload-resource-moniker']).toBe('artifact-1');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      returnOrigin: 'https://app.example.com',
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
      state: 'state-1',
    });
  });

  it.each([
    [400, 'EXCHANGE_NOT_ENABLED'],
    [401, 'AUTH_FAILED'],
    [403, 'INSUFFICIENT_PERMISSIONS'],
    [404, 'NOT_AVAILABLE'],
    [500, 'AUTHORIZE_FAILED'],
    [503, 'AUTHORIZE_FAILED'],
  ])('maps status %i to %s', async (status, code) => {
    mockFetch({ ok: false, status, json: async () => ({}) });
    await expect(
      createExternalEntraHandoffProvider().acquire(request)
    ).rejects.toMatchObject({ code });
  });

  it('maps a network failure to AUTHORIZE_FAILED without leaking the token', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('boom secret-token')
    );
    let caught: unknown;
    try {
      await createExternalEntraHandoffProvider().acquire(request);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EmbedHostError);
    const err = caught as EmbedHostError;
    expect(err.code).toBe('AUTHORIZE_FAILED');
    expect(err.message).not.toContain('secret-token');
  });

  it('rejects a response with no handoff code', async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({}) });
    await expect(
      createExternalEntraHandoffProvider().acquire(request)
    ).rejects.toMatchObject({ code: 'AUTHORIZE_FAILED' });
  });

  it.each([true, false])(
    'recognizes only the canonical 403 and keeps backend diagnostics private (status field: %j)',
    async (includeStatus) => {
      const logs = (['debug', 'error', 'info', 'log', 'warn'] as const).map(
        (method) => vi.spyOn(console, method).mockImplementation(() => {})
      );
      const response = Response.json(
        {
          code: blockedCode,
          ...(includeStatus ? { httpStatusCode: 403 } : {}),
          message: privateText,
          details: [{ code: 'PowerBIApiErrorResponse', message: privateText }],
          accessToken: 'secret-token',
        },
        { status: 403 }
      );
      const readJson = vi.spyOn(response, 'json');
      const clone = vi.spyOn(response, 'clone');
      const fetch = mockFetch(response);

      const error = await createExternalEntraHandoffProvider()
        .acquire(request)
        .catch((error: unknown) => error);

      expect(error).toBeInstanceOf(EmbedHostError);
      expect(error).toMatchObject({
        code: blockedCode,
        message: blockedMessage,
      });
      for (const field of [
        'details',
        'cause',
        'body',
        'response',
        'requestId',
      ]) {
        expect(error).not.toHaveProperty(field);
      }
      const output = [
        String(error),
        JSON.stringify(error),
        JSON.stringify(logs.flatMap((log) => log.mock.calls)),
      ].join('\n');
      expect(output).not.toContain(privateText);
      expect(output).not.toContain('secret-token');
      expect(readJson).not.toHaveBeenCalled();
      expect(clone).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    null,
    [],
    privateText,
    {},
    { code: 'UNKNOWN_BLOCK', message: privateText },
    { code: 'artifactblockedbyadmin' },
    { code: `${blockedCode} ` },
    { error: { code: blockedCode } },
    { errorCode: blockedCode },
    { code: blockedCode, httpStatusCode: 401 },
    { code: blockedCode, httpStatusCode: '403' },
    { code: blockedCode, httpStatusCode: null },
  ])('keeps unsupported 403 JSON generic: %#', async (value) => {
    mockFetch(Response.json(value, { status: 403 }));
    await expect(
      createExternalEntraHandoffProvider().acquire(request)
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_PERMISSIONS',
      message: 'Brokered-authorize endpoint responded with status 403.',
    });
  });

  it.each([
    { body: `{"message":"${privateText}`, contentType: 'application/json' },
    { body: '<html>Synthetic failure</html>', contentType: 'text/html' },
    { body: JSON.stringify({ code: blockedCode }), contentType: 'text/plain' },
    {
      body: JSON.stringify({ code: blockedCode }).padEnd(16 * 1024 + 1, ' '),
      contentType: 'application/json',
    },
  ])(
    'retains generic 403 for malformed, non-JSON, or oversized bodies: %#',
    async ({ body, contentType }) => {
      mockFetch(
        new Response(body, {
          status: 403,
          headers: { 'Content-Type': contentType },
        })
      );
      await expect(
        createExternalEntraHandoffProvider().acquire(request)
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
    }
  );

  it.each([
    { status: 400, code: 'EXCHANGE_NOT_ENABLED' },
    { status: 401, code: 'AUTH_FAILED' },
    { status: 404, code: 'NOT_AVAILABLE' },
    { status: 500, code: 'AUTHORIZE_FAILED' },
  ])(
    'does not classify the body as a block on HTTP $status',
    async ({ status, code }) => {
      const response = Response.json({ code: blockedCode }, { status });
      const reader = vi.spyOn(response.body!, 'getReader');
      mockFetch(response);
      await expect(
        createExternalEntraHandoffProvider().acquire(request)
      ).rejects.toMatchObject({ code });
      expect(reader).not.toHaveBeenCalled();
    }
  );

  it('does not diagnose a successful handoff response', async () => {
    const response = Response.json({
      code: blockedCode,
      handoffCode: 'code-1',
      state: request.state,
    });
    const json = vi.spyOn(response, 'json');
    const clone = vi.spyOn(response, 'clone');
    mockFetch(response);
    await expect(
      createExternalEntraHandoffProvider().acquire(request)
    ).resolves.toEqual({ handoffCode: 'code-1', state: request.state });
    expect(json).toHaveBeenCalledExactlyOnceWith();
    expect(clone).not.toHaveBeenCalled();
  });

  it('keeps a redirected 403 generic', async () => {
    const response = Response.json({ code: blockedCode }, { status: 403 });
    Object.defineProperty(response, 'redirected', { value: true });
    mockFetch(response);
    await expect(
      createExternalEntraHandoffProvider().acquire(request)
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
  });

  it('bounds a stalled 403 body and cancels it without retrying', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      { cancel },
      { highWaterMark: 0 }
    );
    const fetch = mockFetch(
      new Response(body, {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const result = createExternalEntraHandoffProvider()
      .acquire(request)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not trust a custom fetch error carrying the canonical code', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      Object.assign(new Error(privateText), { code: blockedCode, status: 403 })
    );
    const error = await createExternalEntraHandoffProvider()
      .acquire(request)
      .catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'AUTHORIZE_FAILED' });
    expect(String(error)).not.toContain(privateText);
  });

  it('does not attribute a token-callback error to the brokered response', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const failure = new EmbedHostError(privateText, blockedCode);
    const error = await createExternalEntraHandoffProvider()
      .acquire({
        ...request,
        getAccessToken: () => {
          throw failure;
        },
      })
      .catch((error: unknown) => error);
    expect(error).not.toBe(failure);
    expect(error).toMatchObject({ code: 'AUTHORIZE_FAILED' });
    expect(String(error)).not.toContain(privateText);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves other token-callback errors unchanged', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const failure = new EmbedHostError(
      'Synthetic token failure',
      'AUTH_FAILED'
    );
    await expect(
      createExternalEntraHandoffProvider().acquire({
        ...request,
        getAccessToken: () => {
          throw failure;
        },
      })
    ).rejects.toBe(failure);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps an unreadable response stream generic without exposing its error', async () => {
    mockFetch(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error(privateText));
          },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const error = await createExternalEntraHandoffProvider()
      .acquire(request)
      .catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
    expect(error).not.toHaveProperty('cause');
    expect(String(error)).not.toContain(privateText);
  });
});
