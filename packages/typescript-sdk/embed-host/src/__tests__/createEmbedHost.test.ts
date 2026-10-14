import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmbedHost } from '../createEmbedHost';
import { EmbedHostError } from '../errors';
import type { HandoffProvider, HandoffRequest } from '../types';

const IFRAME_ORIGIN = 'https://app.example.com';
// Same value as IFRAME_ORIGIN: the embedded iframe both requests and redeems the
// handoff, so its origin and the return origin coincide (single allowlist).
const RETURN_ORIGIN = 'https://app.example.com';
const OTHER_ORIGIN = 'https://evil.example.com';
const BROKER_URL =
  'https://cap.pbidedicated.windows.net/webapi/capacities/c/workloads/BaaS/BaaSService/automatic/v1/workspaces/w/appbackends/a/api/auth/v1/brokered/authorize/external';
const ARTIFACT_ID = 'a';

/** A fake cross-document window whose postMessage is observable. */
function fakeIframe(): Window & { postMessage: ReturnType<typeof vi.fn> } {
  return { postMessage: vi.fn() } as unknown as Window & {
    postMessage: ReturnType<typeof vi.fn>;
  };
}

function dispatch(data: unknown, origin: string, source: Window): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
}

function readiness(requestId = 'ready-1') {
  return {
    channel: 'fabric-auth',
    version: 1,
    kind: 'externalEmbed.ready',
    requestId,
  };
}

function handoff(requestId = 'req-1', overrides: Record<string, unknown> = {}) {
  return {
    channel: 'fabric-auth',
    version: 1,
    kind: 'auth.requestHandoff',
    requestId,
    payload: {
      callbackUrl: RETURN_ORIGIN,
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
      state: 'state-1',
      brokeredAuthorizeUrl: BROKER_URL,
      artifactId: ARTIFACT_ID,
      ...overrides,
    },
  };
}

const baseOptions = () => ({
  allowedOrigins: [IFRAME_ORIGIN],
  getAccessToken: () => 'delegated-token',
});

describe('createEmbedHost', () => {
  let host: { dispose(): void } | undefined;

  afterEach(() => {
    host?.dispose();
    host = undefined;
    vi.restoreAllMocks();
  });

  it('registers a single listener and disposes it', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    host = createEmbedHost(baseOptions());
    expect(add).toHaveBeenCalledTimes(1);
    host.dispose();
    expect(remove).toHaveBeenCalledTimes(1);
    host.dispose(); // idempotent
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('acknowledges readiness from an allowlisted origin, pinned', () => {
    host = createEmbedHost(baseOptions());
    const iframe = fakeIframe();
    dispatch(readiness(), IFRAME_ORIGIN, iframe);
    expect(iframe.postMessage).toHaveBeenCalledTimes(1);
    const [envelope, opts] = iframe.postMessage.mock.calls[0];
    expect(envelope).toMatchObject({
      kind: 'externalEmbed.ack',
      scenario: 'externalEmbed',
    });
    expect(opts).toEqual({ targetOrigin: IFRAME_ORIGIN });
  });

  it('ignores readiness from a non-allowlisted origin', () => {
    host = createEmbedHost(baseOptions());
    const iframe = fakeIframe();
    dispatch(readiness(), OTHER_ORIGIN, iframe);
    expect(iframe.postMessage).not.toHaveBeenCalled();
  });

  it('brokers a validated handoff and returns the code', async () => {
    const provider: HandoffProvider = {
      acquire: vi.fn(async () => ({ handoffCode: 'code-9', state: 'state-1' })),
    };
    host = createEmbedHost({ ...baseOptions(), handoffProvider: provider });
    const iframe = fakeIframe();
    dispatch(readiness(), IFRAME_ORIGIN, iframe);
    dispatch(handoff(), IFRAME_ORIGIN, iframe);
    await vi.waitFor(() => expect(iframe.postMessage).toHaveBeenCalledTimes(2));
    const [envelope] = iframe.postMessage.mock.calls[1];
    expect(envelope).toMatchObject({
      kind: 'response',
      requestId: 'req-1',
      success: true,
      result: { handoffCode: 'code-9', state: 'state-1' },
    });
  });

  it('rejects a handoff whose source is not the bound iframe', async () => {
    const provider: HandoffProvider = { acquire: vi.fn() };
    host = createEmbedHost({ ...baseOptions(), handoffProvider: provider });
    const iframe = fakeIframe();
    const impostor = fakeIframe();
    dispatch(readiness(), IFRAME_ORIGIN, iframe);
    dispatch(handoff(), IFRAME_ORIGIN, impostor);
    expect(provider.acquire).not.toHaveBeenCalled();
    expect(impostor.postMessage).not.toHaveBeenCalled();
  });

  it('rejects a return origin outside the single allowlist without a network call', async () => {
    const provider: HandoffProvider = { acquire: vi.fn() };
    host = createEmbedHost({ ...baseOptions(), handoffProvider: provider });
    const iframe = fakeIframe();
    dispatch(readiness(), IFRAME_ORIGIN, iframe);
    dispatch(
      handoff('req-2', { callbackUrl: OTHER_ORIGIN }),
      IFRAME_ORIGIN,
      iframe
    );
    await vi.waitFor(() => expect(iframe.postMessage).toHaveBeenCalledTimes(2));
    const [envelope] = iframe.postMessage.mock.calls[1];
    expect(envelope).toMatchObject({
      kind: 'response',
      success: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(provider.acquire).not.toHaveBeenCalled();
  });

  it('maps a provider error to a structured bridge error', async () => {
    const provider: HandoffProvider = {
      acquire: vi.fn(async () => {
        throw new EmbedHostError('nope', 'INSUFFICIENT_PERMISSIONS');
      }),
    };
    host = createEmbedHost({ ...baseOptions(), handoffProvider: provider });
    const iframe = fakeIframe();
    dispatch(readiness(), IFRAME_ORIGIN, iframe);
    dispatch(handoff(), IFRAME_ORIGIN, iframe);
    await vi.waitFor(() => expect(iframe.postMessage).toHaveBeenCalledTimes(2));
    const [envelope] = iframe.postMessage.mock.calls[1];
    expect(envelope).toMatchObject({
      kind: 'response',
      success: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS' },
    });
    expect(JSON.stringify(envelope)).not.toContain('delegated-token');
  });

  it.each([
    {
      body: JSON.stringify({
        code: 'ArtifactBlockedByAdmin',
        httpStatusCode: 403,
        message: 'SYNTHETIC-PRIVATE-BACKEND-TEXT',
        details: [{ message: 'delegated-token' }],
      }),
      code: 'ArtifactBlockedByAdmin',
      message:
        'This app has been blocked by your admin. Reach out to the app owner to get unblocked.',
    },
    {
      body: JSON.stringify({ message: 'SYNTHETIC-PRIVATE-BACKEND-TEXT' }),
      code: 'INSUFFICIENT_PERMISSIONS',
      message: 'Brokered-authorize endpoint responded with status 403.',
    },
    {
      body: '{"code":',
      code: 'INSUFFICIENT_PERMISSIONS',
      message: 'Brokered-authorize endpoint responded with status 403.',
    },
    {
      body: JSON.stringify({
        code: 'UNKNOWN_BLOCK',
        message: 'SYNTHETIC-PRIVATE-BACKEND-TEXT',
      }),
      code: 'INSUFFICIENT_PERMISSIONS',
      message: 'Brokered-authorize endpoint responded with status 403.',
    },
  ])(
    'forwards only the safe default-provider error fields: %#',
    async ({ body, code, message }) => {
      const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(body, {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      host = createEmbedHost(baseOptions());
      const iframe = fakeIframe();
      dispatch(readiness(), IFRAME_ORIGIN, iframe);
      dispatch(handoff(), IFRAME_ORIGIN, iframe);
      await vi.waitFor(() =>
        expect(iframe.postMessage).toHaveBeenCalledTimes(2)
      );

      const [envelope, options] = iframe.postMessage.mock.calls[1];
      expect(envelope).toEqual({
        channel: 'fabric-auth',
        version: 1,
        kind: 'response',
        requestId: 'req-1',
        success: false,
        error: { code, message },
      });
      expect(options).toEqual({ targetOrigin: IFRAME_ORIGIN });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(envelope)).not.toContain('SYNTHETIC-PRIVATE');
      expect(JSON.stringify(envelope)).not.toContain('delegated-token');
      expect(envelope).not.toHaveProperty('result');
    }
  );

  it('passes the delegated token and artifact to the provider', async () => {
    let seen: HandoffRequest | undefined;
    const provider: HandoffProvider = {
      acquire: vi.fn(async (r: HandoffRequest) => {
        seen = r;
        return { handoffCode: 'c' };
      }),
    };
    host = createEmbedHost({ ...baseOptions(), handoffProvider: provider });
    const iframe = fakeIframe();
    dispatch(readiness(), IFRAME_ORIGIN, iframe);
    dispatch(handoff(), IFRAME_ORIGIN, iframe);
    await vi.waitFor(() => expect(provider.acquire).toHaveBeenCalled());
    expect(seen?.artifactId).toBe(ARTIFACT_ID);
    expect(seen?.brokeredAuthorizeUrl).toBe(BROKER_URL);
    expect(await seen?.getAccessToken()).toBe('delegated-token');
  });
});

describe('createEmbedHost environment guard', () => {
  const originalWindow = globalThis.window;
  beforeEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });
  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it('throws outside a browser environment', () => {
    expect(() => createEmbedHost(baseOptions())).toThrow();
  });
});
