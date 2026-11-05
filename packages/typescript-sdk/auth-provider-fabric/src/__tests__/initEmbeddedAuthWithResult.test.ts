import { Auth, type OpaqueSession } from '@microsoft/rayfin-auth';
import {
  ApiClient,
  AuthError,
  NetworkError,
  SdkError,
} from '@microsoft/rayfin-lib';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from 'vitest';

import * as embeddedModule from '../embeddedFabricLogin';
import * as classificationModule from '../externalEmbedClassification';
import * as helpers from '../fabricAuthHelpers';
import {
  clearFabricUserHint,
  persistFabricUserHintFromUrl,
} from '../fabricUserHint';
import {
  initEmbeddedAuth,
  initEmbeddedAuthWithResult,
  type EmbeddedAuthResult,
  type FabricAuthOptions,
} from '../index';

const options: FabricAuthOptions = {
  workspaceId: 'synthetic-workspace',
  projectId: 'synthetic-app',
  fabricPortalUrl: 'https://fabric.example.com',
  returnOrigin: 'https://app.example.com',
};
const embeddedOptions = { ...options, fabricEmbedded: true };
const authenticated: OpaqueSession = {
  user: { id: 'synthetic-user', email: 'user@example.com' },
  isAuthenticated: true,
  isAnonymous: false,
};
const unauthenticated: OpaqueSession = {
  user: null,
  isAuthenticated: false,
  isAnonymous: false,
};
const privateText = 'SYNTHETIC-PRIVATE-TOKEN-AND-RESPONSE';
const requestId = '44444444-4444-4444-4444-444444444444';

describe('initEmbeddedAuthWithResult', () => {
  let auth: Auth;

  beforeEach(() => {
    clearFabricUserHint();
    helpers.resetEmbeddedHandoffStateForTests();
    sessionStorage.removeItem('fabricEmbedded');
    auth = new Auth(
      new ApiClient({
        baseUrl: 'https://api.example.com',
        publishableKey: 'public-key',
        fetch: vi
          .fn<typeof globalThis.fetch>()
          .mockRejectedValue(
            new Error('Unexpected HTTP request in startup-result test')
          ),
      }),
      { storage: false, autoRefreshToken: false }
    );
    vi.spyOn(auth, 'getSession').mockReturnValue(unauthenticated);
    vi.spyOn(embeddedModule, 'embeddedFabricLogin').mockResolvedValue(
      undefined
    );
    vi.spyOn(classificationModule, 'classifyExternalEmbed').mockResolvedValue(
      undefined
    );
    vi.spyOn(classificationModule, 'isExternalEmbedScenario').mockReturnValue(
      false
    );
    vi.spyOn(window, 'open').mockImplementation(() => {
      throw new Error('Startup must not open a popup');
    });
  });

  afterEach(() => {
    expect(window.open).not.toHaveBeenCalled();
    auth.destroy();
    vi.restoreAllMocks();
    clearFabricUserHint();
    helpers.resetEmbeddedHandoffStateForTests();
    sessionStorage.removeItem('fabricEmbedded');
  });

  function withUserHint() {
    const location = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...location, search: '?_fu=synthetic-hint' },
      configurable: true,
      writable: true,
    });
    persistFabricUserHintFromUrl();
    Object.defineProperty(window, 'location', {
      value: location,
      configurable: true,
      writable: true,
    });
  }

  function errorFrom(result: EmbeddedAuthResult): SdkError {
    expect(result.status).toBe('error');
    if (result.status !== 'error') {
      throw new Error('Expected an embedded startup error result');
    }
    expect(result).not.toHaveProperty('session');
    return result.error;
  }

  it('exports a discriminated public result type', () => {
    expectTypeOf<
      Extract<EmbeddedAuthResult, { status: 'authenticated' }>['session']
    >().toEqualTypeOf<OpaqueSession>();
    expectTypeOf<
      Extract<EmbeddedAuthResult, { status: 'error' }>['error']
    >().toEqualTypeOf<SdkError>();
    expectTypeOf<
      Extract<EmbeddedAuthResult, { status: 'not-embedded' }>
    >().toEqualTypeOf<{ status: 'not-embedded' }>();
  });

  it('distinguishes a non-embedded no-op from an authentication failure', async () => {
    await expect(initEmbeddedAuthWithResult(auth, options)).resolves.toEqual({
      status: 'not-embedded',
    });
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(embeddedModule.embeddedFabricLogin).not.toHaveBeenCalled();
  });

  it('returns the authenticated session after handoff', async () => {
    vi.mocked(auth.getSession).mockReturnValue(authenticated);

    await expect(
      initEmbeddedAuthWithResult(auth, embeddedOptions)
    ).resolves.toEqual({
      status: 'authenticated',
      session: authenticated,
    });

    expect(embeddedModule.embeddedFabricLogin).toHaveBeenCalledExactlyOnceWith(
      auth,
      embeddedOptions
    );
  });

  it('resumes an authenticated session only after classification and a user hint', async () => {
    withUserHint();
    vi.mocked(auth.getSession).mockReturnValue(authenticated);

    await expect(
      initEmbeddedAuthWithResult(auth, embeddedOptions)
    ).resolves.toEqual({
      status: 'authenticated',
      session: authenticated,
    });

    expect(classificationModule.classifyExternalEmbed).toHaveBeenCalledOnce();
    expect(embeddedModule.embeddedFabricLogin).not.toHaveBeenCalled();
  });

  it('returns a refreshed session without a handoff', async () => {
    withUserHint();
    vi.spyOn(auth, 'hasRefreshToken').mockReturnValue(true);
    vi.spyOn(auth, 'refreshSession').mockResolvedValue({
      accessToken: 'SYNTHETIC-ACCESS-TOKEN',
      tokenType: 'Bearer',
      expiresIn: 3600,
    });
    vi.mocked(auth.getSession)
      .mockReturnValueOnce(unauthenticated)
      .mockReturnValueOnce(authenticated);

    await expect(
      initEmbeddedAuthWithResult(auth, embeddedOptions)
    ).resolves.toEqual({
      status: 'authenticated',
      session: authenticated,
    });

    expect(embeddedModule.embeddedFabricLogin).not.toHaveBeenCalled();
  });

  it('preserves generic refresh fallback behavior', async () => {
    withUserHint();
    vi.spyOn(auth, 'hasRefreshToken').mockReturnValue(true);
    const refresh = vi
      .spyOn(auth, 'refreshSession')
      .mockRejectedValue(new Error(privateText));
    vi.mocked(auth.getSession)
      .mockReturnValueOnce(unauthenticated)
      .mockReturnValueOnce(authenticated);

    await expect(
      initEmbeddedAuthWithResult(auth, embeddedOptions)
    ).resolves.toEqual({
      status: 'authenticated',
      session: authenticated,
    });

    expect(refresh).toHaveBeenCalledOnce();
    expect(embeddedModule.embeddedFabricLogin).toHaveBeenCalledOnce();
  });

  it('runs external-embed handoff even when a prior authenticated session exists', async () => {
    vi.mocked(classificationModule.isExternalEmbedScenario).mockReturnValue(
      true
    );
    vi.mocked(auth.getSession).mockReturnValue(authenticated);

    await expect(initEmbeddedAuthWithResult(auth, options)).resolves.toEqual({
      status: 'authenticated',
      session: authenticated,
    });

    expect(embeddedModule.embeddedFabricLogin).toHaveBeenCalledExactlyOnceWith(
      auth,
      options
    );
  });

  it('returns the canonical block code and fixed message, without private diagnostics', async () => {
    const failure = Object.assign(
      new AuthError(privateText, 'ArtifactBlockedByAdmin', 403, requestId),
      {
        cause: new Error(privateText),
        response: privateText,
        details: privateText,
      }
    );
    vi.mocked(embeddedModule.embeddedFabricLogin).mockRejectedValueOnce(
      failure
    );
    const warn = vi.spyOn(console, 'warn');

    const error = errorFrom(
      await initEmbeddedAuthWithResult(auth, embeddedOptions)
    );

    expect(error).toBeInstanceOf(AuthError);
    expect(error).toBeInstanceOf(SdkError);
    expect(error).not.toBe(failure);
    expect(error).toMatchObject({
      code: 'ArtifactBlockedByAdmin',
      message:
        'This app has been blocked by your admin. Reach out to the app owner to get unblocked.',
      status: 403,
      requestId,
    });
    expect(String(error)).not.toContain(privateText);
    expect(JSON.stringify(error)).not.toContain(privateText);
    for (const field of ['cause', 'details', 'response', 'body']) {
      expect(error).not.toHaveProperty(field);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    'BRIDGE_TIMEOUT',
    'AUTH_FAILED',
    'INSUFFICIENT_PERMISSIONS',
    'STATE_MISMATCH',
  ])(
    'preserves typed failure code %s without forwarding the host message',
    async (code) => {
      vi.mocked(embeddedModule.embeddedFabricLogin).mockRejectedValueOnce(
        new AuthError(privateText, code)
      );
      const error = errorFrom(
        await initEmbeddedAuthWithResult(auth, embeddedOptions)
      );
      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({
        code,
        message: 'Embedded Fabric authentication failed.',
      });
      expect(JSON.stringify(error)).not.toContain(privateText);
      expect(error).not.toHaveProperty('status');
      expect(error).not.toHaveProperty('requestId');
    }
  );

  it('preserves a network error category and safe status, not its workload diagnostics', async () => {
    vi.mocked(embeddedModule.embeddedFabricLogin).mockRejectedValueOnce(
      Object.assign(new NetworkError(privateText, 503, 'SERVICE_UNAVAILABLE'), {
        workload: { errorCode: privateText },
      })
    );
    const error = errorFrom(
      await initEmbeddedAuthWithResult(auth, embeddedOptions)
    );
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    expect(error).toHaveProperty('workload', undefined);
    expect(JSON.stringify(error)).not.toContain(privateText);
  });

  it.each([
    undefined,
    null,
    privateText,
    new Error(privateText),
    { code: 'ArtifactBlockedByAdmin' },
  ])(
    'returns a safe generic SDK error for an untyped exception %#',
    async (failure) => {
      vi.mocked(embeddedModule.embeddedFabricLogin).mockRejectedValueOnce(
        failure
      );
      const error = errorFrom(
        await initEmbeddedAuthWithResult(auth, embeddedOptions)
      );
      expect(error).toBeInstanceOf(SdkError);
      expect(error).toMatchObject({
        code: 'EMBEDDED_AUTH_FAILED',
        message: 'Embedded Fabric authentication failed.',
      });
      expect(String(error)).not.toContain(privateText);
      expect(JSON.stringify(error)).not.toContain(privateText);
      expect(error).not.toHaveProperty('cause');
    }
  );

  it.each(['private response text', 'INVALID\n', 'A'.repeat(129), ''])(
    'does not forward a malformed or unbounded error code %#',
    async (code) => {
      vi.mocked(embeddedModule.embeddedFabricLogin).mockRejectedValueOnce(
        new AuthError(privateText, code, -1, privateText)
      );
      const error = errorFrom(
        await initEmbeddedAuthWithResult(auth, embeddedOptions)
      );
      expect(error).toMatchObject({ code: 'EMBEDDED_AUTH_FAILED' });
      expect(error).not.toHaveProperty('status');
      expect(error).not.toHaveProperty('requestId');
      expect(JSON.stringify(error)).not.toContain(privateText);
    }
  );

  it('reports handoff completion without an authenticated session as a typed failure', async () => {
    const error = errorFrom(
      await initEmbeddedAuthWithResult(auth, embeddedOptions)
    );
    expect(error).toBeInstanceOf(AuthError);
    expect(error.code).toBe('SESSION_NOT_ESTABLISHED');
  });

  it('captures classification failures instead of rejecting', async () => {
    vi.mocked(classificationModule.classifyExternalEmbed).mockRejectedValueOnce(
      new SdkError(privateText, 'BROWSER_ONLY')
    );
    const error = errorFrom(
      await initEmbeddedAuthWithResult(auth, embeddedOptions)
    );
    expect(error).toMatchObject({ code: 'BROWSER_ONLY' });
    expect(embeddedModule.embeddedFabricLogin).not.toHaveBeenCalled();
  });

  it('captures embedded-mode detection errors before classification', async () => {
    vi.spyOn(helpers, 'isEmbeddedMode').mockImplementationOnce(() => {
      throw new SdkError(privateText, 'BROWSER_ONLY');
    });
    const error = errorFrom(
      await initEmbeddedAuthWithResult(auth, embeddedOptions)
    );
    expect(error).toMatchObject({ code: 'BROWSER_ONLY' });
    expect(classificationModule.classifyExternalEmbed).not.toHaveBeenCalled();
    expect(embeddedModule.embeddedFabricLogin).not.toHaveBeenCalled();
  });

  it('captures a terminal session-resume rejection without attempting handoff', async () => {
    withUserHint();
    vi.spyOn(helpers, 'tryResumeSession').mockRejectedValueOnce(
      new AuthError(privateText, 'ArtifactBlockedByAdmin')
    );
    const error = errorFrom(
      await initEmbeddedAuthWithResult(auth, embeddedOptions)
    );
    expect(error.code).toBe('ArtifactBlockedByAdmin');
    expect(embeddedModule.embeddedFabricLogin).not.toHaveBeenCalled();
  });

  it('captures a failure reading the post-handoff session', async () => {
    vi.mocked(auth.getSession).mockImplementationOnce(() => {
      throw new Error(privateText);
    });
    const error = errorFrom(
      await initEmbeddedAuthWithResult(auth, embeddedOptions)
    );
    expect(error.code).toBe('EMBEDDED_AUTH_FAILED');
    expect(String(error)).not.toContain(privateText);
  });

  it('keeps the legacy handoff failure result null', async () => {
    vi.mocked(embeddedModule.embeddedFabricLogin).mockRejectedValueOnce(
      new AuthError('Safe block message', 'ArtifactBlockedByAdmin')
    );
    await expect(initEmbeddedAuth(auth, embeddedOptions)).resolves.toBeNull();
  });

  it('does not change pre-existing legacy pre-handoff rejection semantics', async () => {
    const failure = new SdkError('Safe preflight failure', 'BROWSER_ONLY');
    vi.mocked(classificationModule.classifyExternalEmbed).mockRejectedValueOnce(
      failure
    );
    await expect(initEmbeddedAuth(auth, embeddedOptions)).rejects.toBe(failure);
  });
});
