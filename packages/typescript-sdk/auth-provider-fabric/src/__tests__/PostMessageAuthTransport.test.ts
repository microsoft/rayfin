import { AuthError, SdkError } from '@microsoft/rayfin-lib';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { requestHandoff } from '../PostMessageAuthTransport';

describe('PostMessageAuthTransport', () => {
  const defaultParams = {
    callbackUrl: 'https://myapp.webapp.rayfingwdev.com',
    codeChallenge: 'test-challenge',
    codeChallengeMethod: 'S256' as const,
    state: 'test-state',
    timeoutMs: 500, // Short timeout for tests
  };

  let originalParent: typeof window.parent;
  let mockPostMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    originalParent = window.parent;

    mockPostMessage = vi.fn();

    // Simulate being inside an iframe (parent !== self)
    Object.defineProperty(window, 'parent', {
      value: { postMessage: mockPostMessage },
      writable: true,
      configurable: true,
    });

    // Stable UUID for deterministic request matching
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'parent', {
      value: originalParent,
      writable: true,
      configurable: true,
    });
  });

  it('sends a fabric-auth request to parent window', async () => {
    const promise = requestHandoff(defaultParams);

    // Simulate host response
    const responseEvent = new MessageEvent('message', {
      source: window.parent,
      data: {
        channel: 'fabric-auth',
        version: 1,
        kind: 'response',
        requestId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        success: true,
        result: { handoffCode: 'code-123', state: 'test-state' },
      },
    });
    window.dispatchEvent(responseEvent);

    await promise;

    expect(mockPostMessage).toHaveBeenCalledOnce();
    const sentMessage = mockPostMessage.mock.calls[0][0];
    expect(sentMessage.channel).toBe('fabric-auth');
    expect(sentMessage.version).toBe(1);
    expect(sentMessage.kind).toBe('auth.requestHandoff');
    expect(sentMessage.requestId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(sentMessage.payload).toEqual({
      callbackUrl: 'https://myapp.webapp.rayfingwdev.com',
      codeChallenge: 'test-challenge',
      codeChallengeMethod: 'S256',
      state: 'test-state',
    });
  });

  it('resolves with handoff result on success response', async () => {
    const promise = requestHandoff(defaultParams);

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: {
          requestId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          kind: 'response',
          success: true,
          result: { handoffCode: 'handoff-abc', state: 'test-state' },
        },
      })
    );

    const result = await promise;
    expect(result).toEqual({
      handoffCode: 'handoff-abc',
      state: 'test-state',
    });
  });

  it('rejects with AuthError on error response', async () => {
    const promise = requestHandoff(defaultParams);

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: {
          requestId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          kind: 'response',
          success: false,
          error: { code: 'PLUGIN_ERROR', message: 'MWC token failed' },
        },
      })
    );

    await expect(promise).rejects.toThrow('MWC token failed');
  });

  it('maps an administrator-block bridge response to the fixed public error', async () => {
    const privateHostText = 'SYNTHETIC-PRIVATE-HOST-MESSAGE';
    const privateDetail = 'SYNTHETIC-PRIVATE-HOST-DETAIL';
    const logs = (['debug', 'error', 'info', 'log', 'warn'] as const).map(
      (method) => vi.spyOn(console, method).mockImplementation(() => {})
    );
    const promise = requestHandoff(defaultParams);

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        origin: 'https://host.example.com',
        data: {
          channel: 'fabric-auth',
          version: 1,
          requestId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          kind: 'response',
          success: false,
          error: {
            code: 'APP_ADMIN_BLOCKED',
            message: privateHostText,
            details: { reason: privateDetail },
          },
        },
      })
    );

    const error = await promise.catch((error: unknown) => error);

    expect(error).toBeInstanceOf(AuthError);
    expect(error).toBeInstanceOf(SdkError);
    expect(error).toMatchObject({
      code: 'ArtifactBlockedByAdmin',
      message:
        'This app has been blocked by your admin. Reach out to the app owner to get unblocked.',
    });
    for (const field of ['details', 'cause', 'status', 'requestId']) {
      expect(error).not.toHaveProperty(field);
    }
    const output = [
      String(error),
      JSON.stringify(error),
      JSON.stringify(logs.flatMap((log) => log.mock.calls)),
    ].join('\n');
    expect(output).not.toContain(privateHostText);
    expect(output).not.toContain(privateDetail);
  });

  it.each([
    'PLUGIN_ERROR',
    'app_admin_blocked',
    'App_Admin_Blocked',
    'APP_ADMIN_BLOCKED ',
    ' APP_ADMIN_BLOCKED',
    'APP_ADMIN_BLOCKED\n',
    'APP_ADMIN_BLOCKED_EXTRA',
    'ArtifactBlockedByAdmin',
  ])(
    'preserves the code and message for other bridge errors: %j',
    async (code) => {
      const message = 'Synthetic generic host error';
      const promise = requestHandoff(defaultParams);

      window.dispatchEvent(
        new MessageEvent('message', {
          source: window.parent,
          data: {
            requestId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            kind: 'response',
            success: false,
            error: { code, message },
          },
        })
      );

      const error = await promise.catch((error: unknown) => error);

      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({ code, message });
    }
  );

  it.each(['source', 'requestId', 'origin'] as const)(
    'ignores an administrator-block response with a mismatched %s',
    async (mismatch) => {
      const origin = 'https://host.example.com';
      const promise = requestHandoff({
        ...defaultParams,
        targetOrigin: origin,
      });
      window.dispatchEvent(
        new MessageEvent('message', {
          source: mismatch === 'source' ? window : window.parent,
          origin: mismatch === 'origin' ? 'https://other.example.com' : origin,
          data: {
            requestId:
              mismatch === 'requestId'
                ? 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
                : 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            kind: 'response',
            success: false,
            error: {
              code: 'APP_ADMIN_BLOCKED',
              message: 'Synthetic host error',
            },
          },
        })
      );
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window.parent,
          origin,
          data: {
            requestId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            kind: 'response',
            success: true,
            result: {
              handoffCode: 'accepted-handoff',
              state: defaultParams.state,
            },
          },
        })
      );

      await expect(promise).resolves.toEqual({
        handoffCode: 'accepted-handoff',
        state: defaultParams.state,
      });
    }
  );

  it('rejects on timeout when no response arrives', async () => {
    const promise = requestHandoff({ ...defaultParams, timeoutMs: 50 });

    await expect(promise).rejects.toThrow('timed out');
  });

  it('ignores messages with non-matching requestId', async () => {
    const promise = requestHandoff(defaultParams);

    // Send a message with a different requestId — should be ignored
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          requestId: 'wrong-id',
          kind: 'response',
          success: true,
          result: { handoffCode: 'wrong', state: 'wrong' },
        },
      })
    );

    // Now send the matching response
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: {
          requestId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          kind: 'response',
          success: true,
          result: { handoffCode: 'correct', state: 'test-state' },
        },
      })
    );

    const result = await promise;
    expect(result.handoffCode).toBe('correct');
  });

  it('ignores non-object messages', async () => {
    const promise = requestHandoff(defaultParams);

    window.dispatchEvent(
      new MessageEvent('message', { data: 'just a string' })
    );
    window.dispatchEvent(new MessageEvent('message', { data: null }));

    // Send the real response
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: {
          requestId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          kind: 'response',
          success: true,
          result: { handoffCode: 'code-ok', state: 'test-state' },
        },
      })
    );

    const result = await promise;
    expect(result.handoffCode).toBe('code-ok');
  });

  it('removes listener after receiving response', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const promise = requestHandoff(defaultParams);

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: {
          requestId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          kind: 'response',
          success: true,
          result: { handoffCode: 'code', state: 'test-state' },
        },
      })
    );

    await promise;
    expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('rejects when no parent window is available', async () => {
    // Simulate top-level window (parent === self)
    Object.defineProperty(window, 'parent', {
      value: window,
      writable: true,
      configurable: true,
    });

    await expect(requestHandoff(defaultParams)).rejects.toThrow(
      'No parent window'
    );
  });
});
