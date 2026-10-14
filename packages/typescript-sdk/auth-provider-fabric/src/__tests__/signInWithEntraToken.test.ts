// @vitest-environment node

import { createServer, type ServerResponse } from 'node:http';
import { inspect } from 'node:util';

import {
  Auth,
  type AuthOptions,
  type AuthStorage,
} from '@microsoft/rayfin-auth';
import { ApiClient, AuthError } from '@microsoft/rayfin-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { signInWithEntraToken, type EntraTokenSignInOptions } from '../index';

const baseUrl =
  'https://fabric.example/webapi/capacities/11111111-1111-1111-1111-111111111111/workspaces/22222222-2222-2222-2222-222222222222/appbackends/33333333-3333-3333-3333-333333333333';
const exchangeUrl = `${baseUrl}/api/auth/v1/brokered/token`;
const entraToken = 'ENTRA-SECRET';
const instances: Auth[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function tokens(
  user = 'alice',
  refreshToken: string | null = 'RAYFIN-REFRESH'
) {
  return {
    accessToken: `e30.${btoa(JSON.stringify({ sub: user, email: `${user}@example.com` }))}.signature`,
    tokenType: 'Bearer',
    expiresIn: 3600,
    refreshToken,
  };
}

function setup(
  fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json(tokens())),
  options: AuthOptions = {},
  url = baseUrl
) {
  const client = new ApiClient({
    baseUrl: url,
    publishableKey: 'public-key',
    headers: { 'X-Custom-Routing': 'route' },
    fetch,
  });
  const auth = new Auth(client, {
    storage: false,
    autoRefreshToken: false,
    ...options,
  });
  instances.push(auth);
  return { auth, client, fetch };
}

function signIn(auth: Auth, token = entraToken) {
  return signInWithEntraToken(auth, { entraToken: token });
}

afterEach(() => {
  instances.splice(0).forEach((auth) => auth.destroy());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('signInWithEntraToken: public entry in Node', () => {
  it('imports and signs in without browser globals, preserving routing and isolating credentials', async () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    expect(typeof localStorage).toBe('undefined');
    const { auth, client, fetch } = setup(undefined, {}, `${baseUrl}/`);
    const sessionToken = vi.fn(() => 'OLD-RAYFIN');
    const refresh = vi.fn();
    client.setAccessTokenCallback(sessionToken);
    client.setRefreshCallback(refresh);
    const login = vi.fn();
    auth.on('AUTH_LOGIN', login);

    const session = await signIn(auth);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe(exchangeUrl);
    expect(request).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
    });
    expect(request?.body).toBeUndefined();
    const headers = new Headers(request?.headers);
    expect(headers.get('Authorization')).toBe(`Bearer ${entraToken}`);
    expect(headers.get('X-Publishable-Key')).toBe('public-key');
    expect(headers.get('X-Custom-Routing')).toBe('route');
    expect(headers.get('x-ms-workload-resource-moniker')).toBe(
      '33333333-3333-3333-3333-333333333333'
    );
    expect(sessionToken).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(session).toMatchObject({
      isAuthenticated: true,
      user: { id: 'alice' },
    });
    expect(session).toEqual(auth.getSession());
    expect(session).not.toHaveProperty('accessToken');
    expect(session).not.toHaveProperty('refreshToken');
    expect(login).toHaveBeenCalledExactlyOnceWith(session);
  });

  it('overrides differently-cased configured authorization without merging it', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(tokens()));
    const client = new ApiClient({
      baseUrl,
      publishableKey: 'key',
      headers: { authorization: 'Bearer OLD-DEFAULT' },
      moniker: 'explicit-moniker',
      fetch,
    });
    const auth = new Auth(client, { storage: false, autoRefreshToken: false });
    instances.push(auth);
    await signIn(auth);
    const headers = new Headers(fetch.mock.calls[0][1]?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${entraToken}`);
    expect(headers.get('x-ms-workload-resource-moniker')).toBe(
      'explicit-moniker'
    );
  });

  it('authenticates shared and separately attached clients with Rayfin, then refreshes only Rayfin', async () => {
    const { auth, client, fetch } = setup();
    const otherFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ ok: true }));
    const other = new ApiClient({
      baseUrl,
      publishableKey: 'key',
      fetch: otherFetch,
    });
    auth.attachToClient(other);
    await signIn(auth);
    fetch.mockResolvedValueOnce(Response.json({ ok: true }));
    await client.get('/data');
    await other.get('/functions/task');
    expect(
      new Headers(fetch.mock.calls[1][1]?.headers).get('Authorization')
    ).toBe(`Bearer ${tokens().accessToken}`);
    expect(
      new Headers(otherFetch.mock.calls[0][1]?.headers).get('Authorization')
    ).toBe(`Bearer ${tokens().accessToken}`);
    fetch.mockResolvedValueOnce(Response.json(tokens('refreshed')));
    await auth.refreshSession();
    expect(fetch.mock.calls[2][0]).toBe(`${baseUrl}/api/auth/v1/token`);
    expect(JSON.parse(String(fetch.mock.calls[2][1]?.body))).toEqual({
      grantType: 'refresh_token',
      refreshToken: 'RAYFIN-REFRESH',
    });
    expect(
      fetch.mock.calls.filter(([url]) => url === exchangeUrl)
    ).toHaveLength(1);
    expect(JSON.stringify(fetch.mock.calls.slice(1))).not.toContain(entraToken);
  });

  it.each([
    '',
    ' ',
    ' \t\r\n',
    'Bearer secret',
    'bearer secret',
    'Bearer',
    'raw token',
  ])('rejects invalid local token %j before sending', async (token) => {
    const { auth, fetch } = setup();
    await expect(signIn(auth, token)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 42])(
    'rejects non-string credentials %j',
    async (token) => {
      const { auth, fetch } = setup();
      await expect(
        signInWithEntraToken(auth, {
          entraToken: token,
        } as unknown as EntraTokenSignInOptions)
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it.each([
    '',
    '/proxy',
    'http://localhost:3000',
    'http://fabric.example',
    'file:///backend',
    'https://user:password@fabric.example',
    'https://fabric.example/path?key=value',
    'https://fabric.example/path#fragment',
    ' https://fabric.example',
    'https:\\\\fabric.example',
  ])('rejects unsafe endpoint %j before sending', async (url) => {
    const { auth, fetch } = setup(undefined, {}, url);
    await expect(signIn(auth)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'EXCHANGE_NOT_ENABLED'],
    [401, 'AUTH_FAILED'],
    [403, 'INSUFFICIENT_PERMISSIONS'],
    [404, 'NOT_AVAILABLE'],
    [429, 'TOKEN_EXCHANGE_FAILED'],
    [500, 'TOKEN_EXCHANGE_FAILED'],
    [503, 'TOKEN_EXCHANGE_FAILED'],
    [302, 'TOKEN_EXCHANGE_FAILED'],
  ])(
    'maps HTTP %i without reading bodies or retrying',
    async (status, code) => {
      const response = new Response(`SECRET ${entraToken}`, {
        status: Number(status),
      });
      const read = vi.spyOn(response, 'json');
      const cancel = vi.spyOn(response.body!, 'cancel');
      const { auth, client, fetch } = setup(
        vi.fn<typeof globalThis.fetch>().mockResolvedValue(response)
      );
      const refresh = vi.fn();
      client.setRefreshCallback(refresh);
      const login = vi.fn();
      auth.on('AUTH_LOGIN', login);
      const error = await signIn(auth).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({ code });
      expect(String(error)).not.toContain('SECRET');
      expect(read).not.toHaveBeenCalled();
      if (Number(status) === 403) {
        expect(cancel).not.toHaveBeenCalled();
      } else {
        expect(cancel).toHaveBeenCalledExactlyOnceWith();
      }
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(refresh).not.toHaveBeenCalled();
      expect(login).not.toHaveBeenCalled();
      expect(auth.getSession().isAuthenticated).toBe(false);
    }
  );

  it('sanitizes network and rejected-redirect errors', async () => {
    const { auth, fetch } = setup(
      vi
        .fn<typeof globalThis.fetch>()
        .mockRejectedValue(new TypeError(`redirect ${entraToken}`))
    );
    const error = await signIn(auth).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'TOKEN_EXCHANGE_FAILED' });
    expect(String(error)).not.toContain(entraToken);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a redirected response even if a custom fetch ignores redirect:error', async () => {
    const response = Response.json(tokens());
    const cancel = vi.spyOn(response.body!, 'cancel');
    Object.defineProperty(response, 'redirected', { value: true });
    const { auth } = setup(
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(response)
    );
    await expect(signIn(auth)).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_FAILED',
    });
    expect(auth.getSession().isAuthenticated).toBe(false);
    expect(cancel).toHaveBeenCalledExactlyOnceWith();
  });

  it.each([false, true])(
    'sanitizes unread-body cancellation failure (redirected: %j)',
    async (redirected) => {
      const response = new Response('SECRET', {
        status: redirected ? 200 : 401,
      });
      Object.defineProperty(response, 'redirected', { value: redirected });
      const cancel = vi
        .spyOn(response.body!, 'cancel')
        .mockRejectedValue(new Error(`Cancellation failed: ${entraToken}`));
      const read = vi.spyOn(response, 'json');
      const { auth, fetch } = setup(
        vi.fn<typeof globalThis.fetch>().mockResolvedValue(response)
      );
      const login = vi.fn();
      auth.on('AUTH_LOGIN', login);
      const error = await signIn(auth).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({ code: 'TOKEN_EXCHANGE_FAILED' });
      expect(String(error)).not.toContain(entraToken);
      expect(error).not.toHaveProperty('cause');
      expect(cancel).toHaveBeenCalledExactlyOnceWith();
      expect(read).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(login).not.toHaveBeenCalled();
      expect(auth.getSession().isAuthenticated).toBe(false);
    }
  );

  it('releases native-fetch connections with unfinished rejected response bodies', async () => {
    const unfinished = new Set<ServerResponse>();
    let closed = 0;
    const server = createServer((_request, response) => {
      unfinished.add(response);
      response.on('close', () => {
        unfinished.delete(response);
        closed++;
      });
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.flushHeaders();
      // Deliberately never finish the response body.
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected a local TCP listener');
      }
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation((_url, options) =>
          globalThis.fetch(`http://127.0.0.1:${address.port}`, options)
        );
      const { auth } = setup(fetch);
      for (let attempt = 0; attempt < 3; attempt++) {
        await expect(signIn(auth)).rejects.toMatchObject({
          code: 'AUTH_FAILED',
        });
      }
      await vi.waitFor(() => {
        expect(unfinished.size).toBe(0);
        expect(closed).toBe(3);
      });
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(auth.getSession().isAuthenticated).toBe(false);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it.each([
    null,
    [],
    {},
    { ...tokens(), accessToken: '' },
    { ...tokens(), accessToken: ' ' },
    { ...tokens(), accessToken: 42 },
    { ...tokens(), tokenType: 'Basic' },
    { ...tokens(), tokenType: null },
    { ...tokens(), expiresIn: '3600' },
    { ...tokens(), expiresIn: 0 },
    { ...tokens(), expiresIn: -1 },
    { ...tokens(), expiresIn: Number.MAX_VALUE },
    { ...tokens(), expiresIn: 1e-20 },
    { ...tokens(), refreshToken: 123 },
    { ...tokens(), scope: [] },
  ])(
    'rejects malformed token fields %# without installing a session',
    async (value) => {
      const { auth } = setup(
        vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(value))
      );
      const login = vi.fn();
      auth.on('AUTH_LOGIN', login);
      await expect(signIn(auth)).rejects.toMatchObject({
        code: 'INVALID_TOKEN_RESPONSE',
      });
      expect(login).not.toHaveBeenCalled();
      expect(auth.getSession().isAuthenticated).toBe(false);
    }
  );

  it.each([
    'not JSON SECRET',
    '',
    '{"accessToken":',
    '{"accessToken":"SECRET","tokenType":"Bearer","expiresIn":1e999}',
  ])('rejects malformed JSON %j', async (body) => {
    const { auth } = setup(
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body))
    );
    const error = await signIn(auth).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'INVALID_TOKEN_RESPONSE' });
    expect(String(error)).not.toContain('SECRET');
  });

  it.each([undefined, null, ''])(
    'accepts optional nullable refresh token and scope %j',
    async (value) => {
      const { auth } = setup(
        vi.fn<typeof globalThis.fetch>().mockResolvedValue(
          Response.json({
            ...tokens(),
            tokenType: 'bearer',
            refreshToken: value,
            scope: value,
          })
        )
      );
      await expect(signIn(auth)).resolves.toMatchObject({
        isAuthenticated: true,
      });
      expect(auth.hasRefreshToken()).toBe(false);
    }
  );

  it('waits for configured async persistence before emitting login or resolving', async () => {
    const write = deferred<void>();
    let stored: string | null = null;
    const storage: AuthStorage = {
      getItem: () => stored,
      setItem: vi.fn(async (_key, value) => {
        await write.promise;
        stored = value;
      }),
      removeItem: vi.fn(),
    };
    const { auth } = setup(undefined, { storage, storageKeyPrefix: 'my-app' });
    const login = vi.fn();
    auth.on('AUTH_LOGIN', login);
    const pending = signIn(auth);
    await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalled());
    expect(auth.getSession().isAuthenticated).toBe(false);
    expect(login).not.toHaveBeenCalled();
    write.resolve();
    await pending;
    expect(storage.setItem).toHaveBeenCalledWith(
      'my-app_authSession',
      expect.any(String)
    );
    expect(stored).toContain('RAYFIN-REFRESH');
    expect(stored).not.toContain(entraToken);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('honors persistSession:false even with custom storage', async () => {
    const storage: AuthStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const { auth } = setup(undefined, { storage, persistSession: false });
    await signIn(auth);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('replaces an existing session, never returning it as explicit success on failure', async () => {
    const { auth, fetch } = setup();
    const old = await signIn(auth);
    fetch.mockResolvedValueOnce(new Response('SECRET', { status: 401 }));
    await expect(signIn(auth, 'SECOND-ENTRA')).rejects.toMatchObject({
      code: 'AUTH_FAILED',
    });
    expect(auth.getSession()).toEqual(old);
    fetch.mockResolvedValueOnce(Response.json(tokens('bob', null)));
    const replacement = await signIn(auth, 'THIRD-ENTRA');
    expect(replacement.user?.id).toBe('bob');
    expect(auth.hasRefreshToken()).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('preserves prior in-memory session and emits no login on persistence failure', async () => {
    let stored: string | null = null;
    const storage: AuthStorage = {
      getItem: () => stored,
      setItem: vi.fn((_key, value) => {
        stored = value;
      }),
      removeItem: vi.fn(),
    };
    const { auth, fetch } = setup(undefined, { storage });
    const previous = await signIn(auth);
    const login = vi.fn();
    auth.on('AUTH_LOGIN', login);
    login.mockClear();
    vi.mocked(storage.setItem).mockRejectedValueOnce(new Error(entraToken));
    fetch.mockResolvedValueOnce(Response.json(tokens('bob')));
    const error = await signIn(auth).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'TOKEN_EXCHANGE_FAILED' });
    expect(String(error)).not.toContain(entraToken);
    expect(auth.getSession()).toEqual(previous);
    expect(login).not.toHaveBeenCalled();
  });

  it('serializes explicit sign-ins in call order and continues after a failed exchange', async () => {
    const first = deferred<Response>();
    const { auth, fetch } = setup(
      vi
        .fn<typeof globalThis.fetch>()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce(Response.json(tokens('bob')))
    );
    const alice = signIn(auth, 'ALICE-ENTRA');
    const rejected = expect(alice).rejects.toMatchObject({
      code: 'AUTH_FAILED',
    });
    const bob = signIn(auth, 'BOB-ENTRA');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    first.resolve(new Response(null, { status: 401 }));
    await rejected;
    await expect(bob).resolves.toMatchObject({ user: { id: 'bob' } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      new Headers(fetch.mock.calls[1][1]?.headers).get('Authorization')
    ).toBe('Bearer BOB-ENTRA');
    expect(auth.getSession().user?.id).toBe('bob');
  });

  it('installs each successful concurrent sign-in in call order', async () => {
    const first = deferred<Response>();
    const { auth, fetch } = setup(
      vi
        .fn<typeof globalThis.fetch>()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce(Response.json(tokens('bob')))
    );
    const login = vi.fn();
    auth.on('AUTH_LOGIN', login);
    const alice = signIn(auth, 'ALICE-ENTRA');
    const bob = signIn(auth, 'BOB-ENTRA');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    first.resolve(Response.json(tokens('alice')));
    await expect(alice).resolves.toMatchObject({ user: { id: 'alice' } });
    await expect(bob).resolves.toMatchObject({ user: { id: 'bob' } });
    expect(login.mock.calls.map(([session]) => session.user.id)).toEqual([
      'alice',
      'bob',
    ]);
    expect(auth.getSession().user?.id).toBe('bob');
  });

  it('does not enqueue a second asynchronous persistence write after explicit login', async () => {
    let stored: string | null = null;
    const storage: AuthStorage = {
      getItem: vi.fn(async () => stored),
      setItem: vi.fn(async (_key, value) => {
        stored = value;
      }),
      removeItem: vi.fn(),
    };
    const { auth, fetch } = setup(undefined, { storage });
    await signIn(auth);
    vi.mocked(storage.getItem).mockClear();
    vi.mocked(storage.setItem).mockClear();
    fetch.mockResolvedValueOnce(Response.json(tokens('bob')));
    await signIn(auth);
    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(stored).toContain(tokens('bob').accessToken);
  });

  it.each([200, 401, 500])(
    'waits for active refresh (%i) before account replacement',
    async (status) => {
      const { auth, fetch } = setup(undefined, { autoRefreshToken: true });
      await signIn(auth);
      const refreshResponse = deferred<Response>();
      fetch
        .mockReturnValueOnce(refreshResponse.promise)
        .mockResolvedValueOnce(Response.json(tokens('bob')));
      const refresh = auth.refreshSession().catch(() => {});
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      const pending = signIn(auth, 'BOB-ENTRA');
      await Promise.resolve();
      expect(fetch).toHaveBeenCalledTimes(2);
      refreshResponse.resolve(
        status === 200
          ? Response.json(tokens('alice-refreshed'))
          : new Response(null, { status })
      );
      await refresh;
      await expect(pending).resolves.toMatchObject({ user: { id: 'bob' } });
      expect(auth.getSession().user?.id).toBe('bob');
      fetch.mockResolvedValueOnce(Response.json(tokens('bob')));
      await expect(auth.refreshSession()).resolves.toBeDefined();
    }
  );

  it('defers refresh started during exchange and uses only the new refresh token', async () => {
    const { auth, fetch } = setup();
    await signIn(auth);
    const exchange = deferred<Response>();
    fetch
      .mockReturnValueOnce(exchange.promise)
      .mockResolvedValueOnce(Response.json(tokens('bob')));
    const pending = signIn(auth, 'BOB-ENTRA');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const refresh = auth.refreshSession();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);
    exchange.resolve(Response.json(tokens('bob', 'BOB-REFRESH')));
    await pending;
    await refresh;
    expect(JSON.parse(String(fetch.mock.calls[2][1]?.body)).refreshToken).toBe(
      'BOB-REFRESH'
    );
    expect(auth.getSession().user?.id).toBe('bob');
  });

  it('defers refresh whose browser cross-tab lock arrives during an exchange', async () => {
    const lock = deferred<void>();
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn(
          async (_name: string, callback: () => Promise<unknown>) => {
            await lock.promise;
            return callback();
          }
        ),
      },
    });
    try {
      const { auth, fetch } = setup();
      await signIn(auth);
      const refresh = auth.refreshSession();
      await vi.waitFor(() =>
        expect(globalThis.navigator.locks.request).toHaveBeenCalled()
      );
      const exchange = deferred<Response>();
      fetch
        .mockReturnValueOnce(exchange.promise)
        .mockResolvedValueOnce(Response.json(tokens('bob')));
      const pending = signIn(auth, 'BOB-ENTRA');
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      lock.resolve();
      await Promise.resolve();
      expect(fetch).toHaveBeenCalledTimes(2);
      exchange.resolve(Response.json(tokens('bob', 'BOB-REFRESH')));
      await pending;
      await refresh;
      expect(
        JSON.parse(String(fetch.mock.calls[2][1]?.body)).refreshToken
      ).toBe('BOB-REFRESH');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses configured timeout and aborts the isolated request without retry', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(
        (_url, request) =>
          new Promise((_resolve, reject) =>
            request?.signal?.addEventListener(
              'abort',
              () => reject(request.signal?.reason),
              { once: true }
            )
          )
      );
    const client = new ApiClient({
      baseUrl,
      publishableKey: 'key',
      timeout: 25,
      fetch,
    });
    const auth = new Auth(client, { storage: false, autoRefreshToken: false });
    instances.push(auth);
    const pending = expect(signIn(auth)).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_FAILED',
    });
    await vi.advanceTimersByTimeAsync(26);
    await pending;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, false])(
    'honors automatic expiry option %j and uses Rayfin refresh',
    async (autoRefreshToken) => {
      vi.useFakeTimers();
      const now = Date.now();
      const { auth, fetch } = setup(
        vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValueOnce(Response.json({ ...tokens(), expiresIn: 2 }))
          .mockResolvedValueOnce(Response.json(tokens('alice'))),
        { autoRefreshToken }
      );
      const session = await signIn(auth);
      expect(session.expiresAt?.getTime()).toBe(now + 2000);
      await vi.advanceTimersByTimeAsync(2001);
      expect(fetch).toHaveBeenCalledTimes(autoRefreshToken ? 2 : 1);
      if (autoRefreshToken) {
        expect(fetch.mock.calls[1][0]).toBe(`${baseUrl}/api/auth/v1/token`);
      }
    }
  );

  it('keeps the configured timeout active while consuming the response body', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async (_url, request) =>
        new Response(
          new ReadableStream({
            start(controller) {
              request?.signal?.addEventListener(
                'abort',
                () => {
                  controller.error(
                    new globalThis.DOMException('Aborted', 'AbortError')
                  );
                },
                { once: true }
              );
            },
          })
        )
    );
    const client = new ApiClient({
      baseUrl,
      publishableKey: 'key',
      timeout: 25,
      fetch,
    });
    const auth = new Auth(client, { storage: false, autoRefreshToken: false });
    instances.push(auth);
    const pending = expect(signIn(auth)).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_FAILED',
    });
    await vi.advanceTimersByTimeAsync(26);
    await pending;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pauses old session expiry during an exchange without a refresh token', async () => {
    vi.useFakeTimers();
    const { auth, fetch } = setup(
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(
          Response.json({ ...tokens('alice', null), expiresIn: 1 })
        ),
      { autoRefreshToken: true }
    );
    await signIn(auth);
    const exchange = deferred<Response>();
    fetch.mockReturnValueOnce(exchange.promise);
    const pending = signIn(auth, 'BOB-ENTRA');
    await vi.advanceTimersByTimeAsync(1500);
    expect(auth.getSession().user?.id).toBe('alice');
    exchange.resolve(Response.json(tokens('bob')));
    await expect(pending).resolves.toMatchObject({ user: { id: 'bob' } });
    expect(auth.getSession().isAuthenticated).toBe(true);
  });

  it('does not overflow the expiration timer for a valid long-lived response', async () => {
    vi.useFakeTimers();
    const { auth, fetch } = setup(
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          Response.json({ ...tokens(), expiresIn: 40 * 24 * 60 * 60 })
        ),
      { autoRefreshToken: true }
    );
    await signIn(auth);
    await vi.advanceTimersByTimeAsync(10);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(auth.getSession().isAuthenticated).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('signInWithEntraToken: response trust boundaries', () => {
  const sensitiveValues = [
    entraToken,
    'SYNTHETIC-ACCESS-TOKEN',
    'SYNTHETIC-REFRESH-TOKEN',
    'SYNTHETIC-COOKIE',
    'SYNTHETIC-DETAIL',
  ];
  const denial = {
    code: 'SYNTHETIC_BLOCK',
    errorCode: 'SYNTHETIC_BLOCK',
    message: 'The synthetic app is blocked by its administrator.',
    details: sensitiveValues.join(' '),
    accessToken: sensitiveValues[1],
    refreshToken: sensitiveValues[2],
    cookie: sensitiveValues[3],
  };

  function observeConsole() {
    return (['debug', 'error', 'info', 'log', 'warn'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {})
    );
  }

  function expectSanitizedFailure(
    error: unknown,
    logs: ReturnType<typeof observeConsole>
  ) {
    const output = [
      String(error),
      JSON.stringify(error),
      inspect(
        logs.flatMap((log) => log.mock.calls),
        { depth: null }
      ),
    ].join('\n');
    for (const value of [...sensitiveValues, denial.message]) {
      expect(output).not.toContain(value);
    }
    for (const field of ['body', 'response', 'details', 'cause']) {
      expect(error).not.toHaveProperty(field);
    }
  }

  describe.each([
    { status: 401, code: 'AUTH_FAILED' },
    { status: 403, code: 'INSUFFICIENT_PERMISSIONS' },
  ])('unrecognized HTTP $status responses', ({ status, code }) => {
    it.each([
      { name: 'empty body', body: '' },
      { name: 'malformed JSON', body: '{"message":"SYNTHETIC-DETAIL"' },
      { name: 'null', body: 'null' },
      { name: 'string', body: JSON.stringify(denial.message) },
      { name: 'number', body: '42' },
      { name: 'boolean', body: 'true' },
      { name: 'array', body: JSON.stringify([denial]) },
      { name: 'unknown root codes', body: JSON.stringify(denial) },
      { name: 'nested codes', body: JSON.stringify({ error: denial }) },
      { name: 'error list', body: JSON.stringify({ errors: [denial] }) },
      { name: 'unknown object', body: JSON.stringify({ reason: denial }) },
      {
        name: 'HTML',
        body: `<h1>${denial.message}</h1><p>${denial.details}</p>`,
        contentType: 'text/html',
      },
      {
        name: 'plain text',
        body: `${denial.message} ${denial.details}`,
        contentType: 'text/plain',
      },
    ])(
      'keeps the generic code for $name without exposing diagnostics',
      async ({ body, contentType }) => {
        const logs = observeConsole();
        const { auth, client, fetch } = setup(
          vi.fn<typeof globalThis.fetch>().mockResolvedValue(
            new Response(body, {
              status,
              headers: { 'Content-Type': contentType ?? 'application/json' },
            })
          )
        );
        const refresh = vi.fn();
        client.setRefreshCallback(refresh);
        const login = vi.fn();
        auth.on('AUTH_LOGIN', login);

        const error = await signIn(auth).catch((error: unknown) => error);

        expect(error).toBeInstanceOf(AuthError);
        expect(error).toMatchObject({ code });
        expectSanitizedFailure(error, logs);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(refresh).not.toHaveBeenCalled();
        expect(login).not.toHaveBeenCalled();
        expect(auth.getSession().isAuthenticated).toBe(false);
      }
    );
  });

  it.each([
    { status: 401, code: 'AUTH_FAILED' },
    { status: 403, code: 'INSUFFICIENT_PERMISSIONS' },
  ])(
    'cancels an unbounded non-JSON HTTP $status body without pulling it',
    async ({ status, code }) => {
      const pull = vi.fn();
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pull();
            controller.enqueue(new TextEncoder().encode(denial.details));
          },
          cancel,
        },
        { highWaterMark: 0 }
      );
      const { auth, fetch } = setup(
        vi.fn<typeof globalThis.fetch>().mockResolvedValue(
          new Response(body, {
            status,
            headers: { 'Content-Type': 'text/plain' },
          })
        )
      );

      await expect(signIn(auth)).rejects.toMatchObject({ code });

      expect(pull).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(auth.getSession().isAuthenticated).toBe(false);
    }
  );

  it.each(['fetch', 'storage read', 'storage write'])(
    'does not trust a denial-coded AuthError from %s',
    async (source) => {
      const logs = observeConsole();
      const failure = Object.assign(
        new AuthError(`${denial.message} ${denial.details}`, denial.code),
        { status: 403, details: denial }
      );
      const storage: AuthStorage = {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      };
      const fetch = vi.fn<typeof globalThis.fetch>();
      if (source === 'fetch') {
        fetch.mockRejectedValue(failure);
      } else {
        fetch.mockResolvedValue(Response.json(tokens()));
      }
      const { auth, client } = setup(fetch, { storage });
      if (source === 'storage read') {
        vi.mocked(storage.getItem).mockImplementation(() => {
          throw failure;
        });
      } else if (source === 'storage write') {
        vi.mocked(storage.setItem).mockImplementation(() => {
          throw failure;
        });
      }
      const refresh = vi.fn();
      client.setRefreshCallback(refresh);
      const login = vi.fn();
      auth.on('AUTH_LOGIN', login);

      const error = await signIn(auth).catch((error: unknown) => error);

      expect(error).toBeInstanceOf(AuthError);
      expect(error).not.toBe(failure);
      expect(error).toMatchObject({ code: 'TOKEN_EXCHANGE_FAILED' });
      expectSanitizedFailure(error, logs);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(refresh).not.toHaveBeenCalled();
      expect(login).not.toHaveBeenCalled();
      expect(auth.getSession().isAuthenticated).toBe(false);
    }
  );

  it('rejects a denial-shaped HTTP success as an invalid token response', async () => {
    const logs = observeConsole();
    const { auth, client, fetch } = setup(
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(denial))
    );
    const refresh = vi.fn();
    client.setRefreshCallback(refresh);
    const login = vi.fn();
    auth.on('AUTH_LOGIN', login);

    const error = await signIn(auth).catch((error: unknown) => error);

    expect(error).toMatchObject({ code: 'INVALID_TOKEN_RESPONSE' });
    expectSanitizedFailure(error, logs);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
    expect(auth.getSession().isAuthenticated).toBe(false);
  });

  it('consumes successful token JSON once for authentication, not diagnostics', async () => {
    const logs = observeConsole();
    const tokenResponse = tokens();
    const response = Response.json({ ...denial, ...tokenResponse });
    const json = vi.spyOn(response, 'json');
    const text = vi.spyOn(response, 'text');
    const clone = vi.spyOn(response, 'clone');
    const cancel = vi.spyOn(response.body!, 'cancel');
    const { auth, fetch } = setup(
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(response)
    );

    const session = await signIn(auth);

    expect(session.isAuthenticated).toBe(true);
    expect(json).toHaveBeenCalledExactlyOnceWith();
    expect(text).not.toHaveBeenCalled();
    expect(clone).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    const output = inspect([session, logs.flatMap((log) => log.mock.calls)], {
      depth: null,
    });
    for (const value of [
      ...sensitiveValues,
      tokenResponse.accessToken,
      tokenResponse.refreshToken,
    ]) {
      expect(output).not.toContain(value);
    }
  });
});
