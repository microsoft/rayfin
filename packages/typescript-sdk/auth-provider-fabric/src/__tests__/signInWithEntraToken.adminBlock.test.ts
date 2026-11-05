// @vitest-environment node

import { createServer, type ServerResponse } from 'node:http';
import { inspect } from 'node:util';

import { Auth, type AuthStorage } from '@microsoft/rayfin-auth';
import { ApiClient, AuthError } from '@microsoft/rayfin-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { tryResumeSession } from '../fabricAuthHelpers';
import { signInWithBrokeredToken, signInWithEntraToken } from '../index';

const code = 'ArtifactBlockedByAdmin';
const message =
  'This app has been blocked by your admin. Reach out to the app owner to get unblocked.';
const requestId = '44444444-4444-4444-4444-444444444444';
const entraToken = 'SYNTHETIC-ENTRA-TOKEN';
const privateText = 'SYNTHETIC-PRIVATE-RESPONSE';
const instances: Auth[] = [];

function tokens() {
  return {
    accessToken: `e30.${btoa(JSON.stringify({ sub: 'synthetic-user' }))}.signature`,
    tokenType: 'Bearer',
    expiresIn: 3600,
    refreshToken: 'SYNTHETIC-REFRESH-TOKEN',
  };
}

function denial() {
  return {
    code,
    message: `${privateText} ${entraToken}`,
    httpStatusCode: 403,
    details: [
      { code: 'RootActivityId', message: requestId },
      { code: 'PowerBIApiErrorResponse', message: `${privateText} not JSON` },
    ],
    accessToken: 'SYNTHETIC-ACCESS-TOKEN',
    refreshToken: 'SYNTHETIC-REFRESH-TOKEN',
    cookie: 'SYNTHETIC-COOKIE',
  };
}

function setup(storage: AuthStorage | false = false, timeout?: number) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = new ApiClient({
    baseUrl: 'https://fabric.example/workload/backend',
    publishableKey: 'public-key',
    fetch,
    timeout,
  });
  const auth = new Auth(client, { storage, autoRefreshToken: false });
  instances.push(auth);
  const refresh = vi.fn();
  const exhausted = vi.fn();
  client.setRefreshCallback(refresh);
  client.setAuthExhaustedCallback(exhausted);
  return { auth, client, fetch, refresh, exhausted };
}

function signIn(auth: Auth) {
  return signInWithEntraToken(auth, { entraToken });
}

afterEach(() => {
  instances.splice(0).forEach((auth) => auth.destroy());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('direct Entra administrator-block rejection', () => {
  it('returns only the approved typed fields and never copies response diagnostics', async () => {
    const logs = (['debug', 'error', 'info', 'log', 'warn'] as const).map(
      (method) => vi.spyOn(console, method).mockImplementation(() => {})
    );
    const { auth, fetch, refresh, exhausted } = setup();
    const response = Response.json(denial(), { status: 403 });
    const clone = vi.spyOn(response, 'clone');
    fetch.mockResolvedValueOnce(response);
    const login = vi.fn();
    auth.on('AUTH_LOGIN', login);

    const error = await signIn(auth).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ code, message, status: 403, requestId });
    for (const field of ['body', 'response', 'details', 'cause', 'workload']) {
      expect(error).not.toHaveProperty(field);
    }
    const output = inspect(
      [
        error,
        String(error),
        JSON.stringify(error),
        logs.flatMap((log) => log.mock.calls),
      ],
      { depth: null }
    );
    for (const value of [
      entraToken,
      privateText,
      'SYNTHETIC-ACCESS-TOKEN',
      'SYNTHETIC-REFRESH-TOKEN',
      'SYNTHETIC-COOKIE',
      'PowerBIApiErrorResponse',
    ]) {
      expect(output).not.toContain(value);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(exhausted).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
    expect(clone).not.toHaveBeenCalled();
    expect(auth.getSession().isAuthenticated).toBe(false);
  });

  it('recognizes a minimal contract and omits unknown correlation', async () => {
    const { auth, fetch } = setup();
    fetch.mockResolvedValueOnce(Response.json({ code }, { status: 403 }));
    const error = await signIn(auth).catch((error: unknown) => error);
    expect(error).toMatchObject({ code, message, status: 403 });
    expect(error).not.toHaveProperty('requestId');
  });

  it.each([
    { status: 200, expected: 'INVALID_TOKEN_RESPONSE' },
    { status: 201, expected: 'INVALID_TOKEN_RESPONSE' },
    { status: 400, expected: 'EXCHANGE_NOT_ENABLED' },
    { status: 401, expected: 'AUTH_FAILED' },
    { status: 404, expected: 'NOT_AVAILABLE' },
    { status: 500, expected: 'TOKEN_EXCHANGE_FAILED' },
  ])(
    'keeps HTTP $status on its existing fallback',
    async ({ status, expected }) => {
      const { auth, fetch, refresh } = setup();
      fetch.mockResolvedValueOnce(Response.json(denial(), { status }));
      const error = await signIn(auth).catch((error: unknown) => error);
      expect(error).toMatchObject({ code: expected });
      expect(error).not.toHaveProperty('requestId');
      expect(String(error)).not.toContain(privateText);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(refresh).not.toHaveBeenCalled();
    }
  );

  it.each([
    { code, httpStatusCode: 401 },
    { code, httpStatusCode: '403' },
    { code, httpStatusCode: null },
    { error: { code } },
    { errorCode: code },
    { code: code.toLowerCase() },
    [{ code }],
    {
      details: [
        {
          code: 'PowerBIApiErrorResponse',
          message: JSON.stringify({ error: { code } }),
        },
      ],
    },
  ])('keeps an unsupported 403 shape generic %#', async (value) => {
    const { auth, fetch } = setup();
    fetch.mockResolvedValueOnce(Response.json(value, { status: 403 }));
    await expect(signIn(auth)).rejects.toMatchObject({
      code: 'INSUFFICIENT_PERMISSIONS',
    });
  });

  it('keeps a rejected replacement from changing the existing session or storage', async () => {
    let stored: string | null = null;
    const storage: AuthStorage = {
      getItem: () => stored,
      setItem: vi.fn((_key, value) => {
        stored = value;
      }),
      removeItem: vi.fn(),
    };
    const { auth, fetch, refresh, exhausted } = setup(storage);
    fetch.mockResolvedValueOnce(Response.json(tokens()));
    const previous = await signIn(auth);
    const previousStored = stored;
    vi.mocked(storage.setItem).mockClear();
    const login = vi.fn();
    const logout = vi.fn();
    auth.on('AUTH_LOGIN', login);
    auth.on('AUTH_LOGOUT', logout);
    expect(login).toHaveBeenCalledExactlyOnceWith(previous);
    login.mockClear();
    fetch.mockResolvedValueOnce(Response.json(denial(), { status: 403 }));

    await expect(signIn(auth)).rejects.toMatchObject({ code, status: 403 });

    expect(auth.getSession()).toEqual(previous);
    expect(auth.hasRefreshToken()).toBe(true);
    expect(stored).toBe(previousStored);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(exhausted).not.toHaveBeenCalled();
  });

  it.each([
    'fetch',
    'storage read',
    'storage write',
    'brokered storage',
  ] as const)('does not trust the exact code thrown by %s', async (source) => {
    const failure = new AuthError(privateText, code, 403, requestId);
    const storage: AuthStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const { auth, fetch } = setup(storage);
    if (source === 'fetch') {
      fetch.mockRejectedValueOnce(failure);
    } else {
      fetch.mockResolvedValueOnce(Response.json(tokens()));
      if (source === 'storage read') {
        vi.mocked(storage.getItem).mockImplementation(() => {
          throw failure;
        });
      } else {
        vi.mocked(storage.setItem).mockImplementation(() => {
          throw failure;
        });
      }
    }
    const request =
      source === 'brokered storage'
        ? signInWithBrokeredToken(auth, tokens())
        : signIn(auth);
    const error = await request.catch((error: unknown) => error);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).not.toBe(failure);
    expect(error).toMatchObject({ code: 'TOKEN_EXCHANGE_FAILED' });
    expect(error).not.toHaveProperty('requestId');
    expect(String(error)).not.toContain(privateText);
    expect(auth.getSession().isAuthenticated).toBe(false);
  });

  it('does not diagnose a valid successful token response carrying the same code', async () => {
    const { auth, fetch } = setup();
    const response = Response.json({ ...denial(), ...tokens() });
    const json = vi.spyOn(response, 'json');
    const clone = vi.spyOn(response, 'clone');
    fetch.mockResolvedValueOnce(response);
    await expect(signIn(auth)).resolves.toMatchObject({
      isAuthenticated: true,
    });
    expect(json).toHaveBeenCalledExactlyOnceWith();
    expect(clone).not.toHaveBeenCalled();
  });

  it('rejects a redirected 403 without inspecting its body', async () => {
    const { auth, fetch } = setup();
    const response = Response.json(denial(), { status: 403 });
    Object.defineProperty(response, 'redirected', { value: true });
    const reader = vi.spyOn(response.body!, 'getReader');
    const cancel = vi.spyOn(response.body!, 'cancel');
    fetch.mockResolvedValueOnce(response);
    await expect(signIn(auth)).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_FAILED',
    });
    expect(reader).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledExactlyOnceWith();
  });

  it('immediately cancels generic 401 JSON streams without pulling them', async () => {
    const { auth, fetch } = setup();
    const pull = vi.fn();
    const cancel = vi.fn();
    fetch.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    );
    await expect(signIn(auth)).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels and falls back after the bounded 403 read deadline', async () => {
    vi.useFakeTimers();
    const { auth, fetch, refresh } = setup();
    const cancel = vi.fn();
    fetch.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const result = signIn(auth).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['truncated', 'request timeout'] as const)(
    'preserves generic 403 after a native %s response body without cancelling it twice',
    async (failure) => {
      let outgoing: ServerResponse | undefined;
      const server = createServer((_request, response) => {
        outgoing = response;
        response.writeHead(403, {
          'Content-Type': 'application/json',
          'Content-Length': '1024',
        });
        response.write(`{"message":"${privateText}`);
        response.flushHeaders();
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
      );
      try {
        const address = server.address();
        if (!address || typeof address === 'string') {
          throw new Error('Expected a local TCP listener');
        }
        const { auth, fetch, refresh } = setup(false, 250);
        let received: Response | undefined;
        let cancel: ReturnType<typeof vi.spyOn> | undefined;
        fetch.mockImplementationOnce(async (_url, options) => {
          received = await globalThis.fetch(
            `http://127.0.0.1:${address.port}`,
            options
          );
          if (!received.body || !outgoing) {
            throw new Error('Expected a native response body');
          }
          cancel = vi.spyOn(received.body, 'cancel');
          if (failure === 'truncated') {
            outgoing.destroy();
          }
          return received;
        });

        const error = await signIn(auth).catch((error: unknown) => error);

        expect(received?.status).toBe(403);
        expect(error).toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' });
        expect(error).not.toHaveProperty('requestId');
        expect(String(error)).not.toContain(privateText);
        expect(cancel).not.toHaveBeenCalled();
        expect(received?.body?.locked).toBe(false);
        expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(
          failure === 'request timeout'
        );
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(refresh).not.toHaveBeenCalled();
        expect(auth.getSession().isAuthenticated).toBe(false);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
    }
  );
});

describe('session resume with an administrator-block rejection', () => {
  function expiredStorage(): AuthStorage {
    return {
      getItem: () =>
        JSON.stringify({
          user: { id: 'synthetic-user' },
          ...tokens(),
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
  }

  it('surfaces the trusted refresh rejection instead of continuing to another login', async () => {
    const { auth, fetch } = setup(expiredStorage());
    fetch.mockResolvedValueOnce(Response.json(denial(), { status: 403 }));
    expect(auth.getSession().isAuthenticated).toBe(false);
    expect(auth.hasRefreshToken()).toBe(true);

    await expect(tryResumeSession(auth)).rejects.toMatchObject({
      code,
      status: 403,
      requestId,
    });
    await expect(tryResumeSession(auth)).rejects.toMatchObject({
      code,
      status: 403,
      requestId,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(auth.hasRefreshToken()).toBe(true);
  });

  it('does not classify a caller-thrown AuthError during refresh', async () => {
    const { auth, fetch } = setup(expiredStorage());
    vi.spyOn(auth, 'refreshSession').mockRejectedValueOnce(
      new AuthError(privateText, code, 403, requestId)
    );
    await expect(tryResumeSession(auth)).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not surface a foreign historical rejection as this session resume result', async () => {
    const source = setup();
    source.fetch.mockResolvedValueOnce(
      Response.json(denial(), { status: 403 })
    );
    const historical = await signIn(source.auth).catch(
      (error: unknown) => error
    );
    expect(historical).toMatchObject({ code, requestId });
    const { auth, fetch } = setup(expiredStorage());
    vi.spyOn(auth, 'refreshSession').mockRejectedValueOnce(historical);

    await expect(tryResumeSession(auth)).resolves.toBeNull();

    expect(fetch).not.toHaveBeenCalled();
  });
});
