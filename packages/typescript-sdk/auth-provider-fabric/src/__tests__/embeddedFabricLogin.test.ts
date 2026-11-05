import { AuthError, SdkError } from '@microsoft/rayfin-lib';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as transportModule from '../PostMessageAuthTransport';
import { embeddedFabricLogin } from '../embeddedFabricLogin';
import { ensureSignedInWithFabric } from '../ensureSignedInWithFabric';
import * as classificationModule from '../externalEmbedClassification';
import {
  hasEmbeddedHandoffCompleted,
  resetEmbeddedHandoffStateForTests,
} from '../fabricAuthHelpers';
import {
  clearFabricUserHint,
  persistFabricUserHintFromUrl,
} from '../fabricUserHint';
import * as initiateFabricLoginModule from '../initiateFabricLogin';
import type { FabricAuthOptions } from '../types';

/**
 * Simulates a host that stamps the `?_fu=` identity hint (i.e. the workload gate is comparing).
 *
 * Stamps the entry URL and lets the module capture it, then restores the URL - the hint has to
 * outlive the query string within a document, but must not be injected into module state directly,
 * or the test would not exercise the same path the browser takes.
 */
function withUserHint(): void {
  const original = window.location;
  Object.defineProperty(window, 'location', {
    value: { ...original, search: '?_fu=ToVQv3p2KO1E1KwCWmoxFw' },
    writable: true,
    configurable: true,
  });
  persistFabricUserHintFromUrl();
  Object.defineProperty(window, 'location', {
    value: original,
    writable: true,
    configurable: true,
  });
}

// Mock PKCE generation from @microsoft/rayfin-auth
vi.mock('@microsoft/rayfin-auth', () => ({
  generateCodeVerifier: vi.fn(() => 'test-verifier'),
  generateCodeChallenge: vi.fn(async () => 'test-challenge'),
  generateState: vi.fn(() => 'test-state'),
}));

describe('embeddedFabricLogin', () => {
  const options: FabricAuthOptions = {
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    fabricPortalUrl: 'https://app.fabric.microsoft.com',
    returnOrigin: 'https://myapp.webapp.rayfingwdev.com',
  };

  let mockAuth: any;
  let mockExchangeVerificationCode: ReturnType<typeof vi.fn>;
  let mockSignOut: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    clearFabricUserHint();
    resetEmbeddedHandoffStateForTests();

    mockExchangeVerificationCode = vi.fn().mockResolvedValue({
      accessToken: 'at-123',
      refreshToken: 'rt-456',
    });

    mockSignOut = vi.fn().mockResolvedValue(undefined);

    mockAuth = {
      getAuthApi: vi.fn(() => ({
        exchangeVerificationCode: mockExchangeVerificationCode,
      })),
      createSessionFromTokenResponse: vi.fn(),
      signOut: mockSignOut,
    };

    vi.spyOn(transportModule, 'requestHandoff').mockResolvedValue({
      handoffCode: 'handoff-code-abc',
      state: 'test-state',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearFabricUserHint();
    resetEmbeddedHandoffStateForTests();
  });

  it('sends handoff request with PKCE params and creates session', async () => {
    await embeddedFabricLogin(mockAuth, options);

    expect(transportModule.requestHandoff).toHaveBeenCalledWith({
      callbackUrl: 'https://myapp.webapp.rayfingwdev.com',
      codeChallenge: 'test-challenge',
      codeChallengeMethod: 'S256',
      state: 'test-state',
    });

    expect(mockExchangeVerificationCode).toHaveBeenCalledWith({
      verificationCode: 'handoff-code-abc',
      codeVerifier: 'test-verifier',
      codeType: 'fabric_handoff',
      redirectUri: 'https://myapp.webapp.rayfingwdev.com',
    });

    expect(mockAuth.createSessionFromTokenResponse).toHaveBeenCalledWith({
      accessToken: 'at-123',
      refreshToken: 'rt-456',
    });
  });

  it('does not write PKCE to localStorage', async () => {
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem');

    await embeddedFabricLogin(mockAuth, options);

    // No PKCE-related localStorage writes
    const pkceWrites = setItemSpy.mock.calls.filter(
      ([key]) =>
        key.includes('verifier') ||
        key.includes('challenge') ||
        key.includes('pkce')
    );
    expect(pkceWrites).toHaveLength(0);
  });

  it('throws on state mismatch', async () => {
    vi.mocked(transportModule.requestHandoff).mockResolvedValue({
      handoffCode: 'code',
      state: 'wrong-state',
    });

    await expect(embeddedFabricLogin(mockAuth, options)).rejects.toThrow(
      'State mismatch'
    );
  });

  it('throws when returnOrigin is missing', async () => {
    const badOptions = { ...options, returnOrigin: '' };

    await expect(embeddedFabricLogin(mockAuth, badOptions)).rejects.toThrow(
      'returnOrigin is required'
    );
  });

  it('propagates transport errors', async () => {
    vi.mocked(transportModule.requestHandoff).mockRejectedValue(
      new Error('Transport failed')
    );

    await expect(embeddedFabricLogin(mockAuth, options)).rejects.toThrow(
      'Transport failed'
    );

    expect(mockAuth.createSessionFromTokenResponse).not.toHaveBeenCalled();
  });

  it.each(['embeddedFabricLogin', 'ensureSignedInWithFabric'] as const)(
    'propagates the normal host administrator-block response through %s without fallback',
    async (entryPoint) => {
      withUserHint();
      vi.mocked(transportModule.requestHandoff).mockRestore();
      vi.spyOn(classificationModule, 'classifyExternalEmbed').mockResolvedValue(
        undefined
      );
      vi.spyOn(classificationModule, 'isExternalEmbedScenario').mockReturnValue(
        false
      );
      const popup = vi
        .spyOn(initiateFabricLoginModule, 'initiateFabricLogin')
        .mockResolvedValue(undefined);
      mockAuth.getSession = vi.fn(() => ({
        isAuthenticated: false,
        user: null,
      }));
      mockAuth.hasRefreshToken = vi.fn(() => false);
      mockAuth.refreshSession = vi.fn();
      const privateHostText = 'SYNTHETIC-PRIVATE-HOST-MESSAGE';
      const postMessage = vi.fn((request: { requestId: string }) => {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window.parent,
            origin: 'https://host.example.com',
            data: {
              channel: 'fabric-auth',
              version: 1,
              requestId: request.requestId,
              kind: 'response',
              success: false,
              error: {
                code: 'APP_ADMIN_BLOCKED',
                message: privateHostText,
                details: { reason: 'SYNTHETIC-PRIVATE-HOST-DETAIL' },
              },
            },
          })
        );
      });
      const parent = window.parent;
      Object.defineProperty(window, 'parent', {
        value: { postMessage },
        writable: true,
        configurable: true,
      });
      try {
        const embeddedOptions = { ...options, fabricEmbedded: true };
        const promise =
          entryPoint === 'embeddedFabricLogin'
            ? embeddedFabricLogin(mockAuth, embeddedOptions)
            : ensureSignedInWithFabric(mockAuth, embeddedOptions);
        const error = await promise.catch((error: unknown) => error);

        expect(error).toBeInstanceOf(AuthError);
        expect(error).toBeInstanceOf(SdkError);
        expect(error).toMatchObject({
          code: 'ArtifactBlockedByAdmin',
          message:
            'This app has been blocked by your admin. Reach out to the app owner to get unblocked.',
        });
        expect(String(error)).not.toContain(privateHostText);
        expect(JSON.stringify(error)).not.toContain('SYNTHETIC-PRIVATE');
        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage.mock.calls[0][0]).toMatchObject({
          channel: 'fabric-auth',
          kind: 'auth.requestHandoff',
        });
        expect(popup).not.toHaveBeenCalled();
        expect(mockSignOut).not.toHaveBeenCalled();
        expect(mockAuth.refreshSession).not.toHaveBeenCalled();
        expect(mockExchangeVerificationCode).not.toHaveBeenCalled();
        expect(mockAuth.createSessionFromTokenResponse).not.toHaveBeenCalled();
        expect(hasEmbeddedHandoffCompleted()).toBe(false);
      } finally {
        Object.defineProperty(window, 'parent', {
          value: parent,
          writable: true,
          configurable: true,
        });
      }
    }
  );

  it('propagates token exchange errors', async () => {
    mockExchangeVerificationCode.mockRejectedValue(
      new Error('Token exchange failed')
    );

    await expect(embeddedFabricLogin(mockAuth, options)).rejects.toThrow(
      'Token exchange failed'
    );

    expect(mockAuth.createSessionFromTokenResponse).not.toHaveBeenCalled();
  });

  it('does NOT sign out before requesting handoff when the host stamps a user hint', async () => {
    withUserHint();

    await embeddedFabricLogin(mockAuth, options);

    // The workload gate has already rejected a cross-user cookie before the app booted, so signing
    // out here would only destroy a valid session and the serve cookie sealed to it.
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(transportModule.requestHandoff).toHaveBeenCalled();
    expect(mockAuth.createSessionFromTokenResponse).toHaveBeenCalled();
  });

  it('signs out before requesting handoff when the host stamps no user hint', async () => {
    await embeddedFabricLogin(mockAuth, options);

    // Legacy host: nothing compared identities server-side, so the pre-feature protection stands.
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    const signOutOrder = mockSignOut.mock.invocationCallOrder[0];
    const handoffOrder = vi.mocked(transportModule.requestHandoff).mock
      .invocationCallOrder[0];
    expect(signOutOrder).toBeLessThan(handoffOrder);
  });

  it('continues with the handoff when the legacy signOut throws', async () => {
    mockSignOut.mockRejectedValue(new Error('Network error during signout'));

    await embeddedFabricLogin(mockAuth, options);

    expect(transportModule.requestHandoff).toHaveBeenCalled();
    expect(mockAuth.createSessionFromTokenResponse).toHaveBeenCalled();
  });

  describe('externalEmbed scenario', () => {
    beforeEach(() => {
      vi.spyOn(classificationModule, 'isExternalEmbedScenario').mockReturnValue(
        true
      );
      vi.spyOn(classificationModule, 'getPinnedParentOrigin').mockReturnValue(
        'https://portal.contoso.com'
      );
      mockAuth.getAuthApi = vi.fn(() => ({
        exchangeVerificationCode: mockExchangeVerificationCode,
        getBrokeredAuthorizeExternalUrl: vi.fn(
          () =>
            'https://cap.pbidedicated.windows.net/api/auth/v1/brokered/authorize/external'
        ),
      }));
    });

    it('always signs out before the handoff, even when a user hint is present', async () => {
      withUserHint();

      await embeddedFabricLogin(mockAuth, options);

      // externalEmbed ignores `?_fu=` entirely and always discards prior state.
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });

    it('sends brokeredAuthorizeUrl, artifactId, and the pinned targetOrigin', async () => {
      await embeddedFabricLogin(mockAuth, options);

      expect(transportModule.requestHandoff).toHaveBeenCalledWith({
        callbackUrl: 'https://myapp.webapp.rayfingwdev.com',
        codeChallenge: 'test-challenge',
        codeChallengeMethod: 'S256',
        state: 'test-state',
        brokeredAuthorizeUrl:
          'https://cap.pbidedicated.windows.net/api/auth/v1/brokered/authorize/external',
        artifactId: 'project-1',
        targetOrigin: 'https://portal.contoso.com',
      });
    });
  });
});
