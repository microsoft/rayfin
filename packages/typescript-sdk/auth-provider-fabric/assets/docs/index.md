# Fabric auth provider

Fabric brokered authentication helpers for Rayfin applications.

Use `@microsoft/rayfin-auth-provider-fabric` to sign in through a Fabric-hosted browser experience or exchange an existing delegated Entra token directly for a Rayfin session.

Popup and iframe helpers require a browser.
`signInWithEntraToken()` supports browsers and Node.js and installs the exchanged session on your existing `Auth` instance.

## Installation

```bash
npm install @microsoft/rayfin-auth-provider-fabric @microsoft/rayfin-auth @microsoft/rayfin-lib
```

## Direct Entra token sign-in

Use this flow when your app already obtains a delegated Entra token through MSAL, Azure CLI, or another identity library.
Token acquisition remains your responsibility.
The token must target the Fabric/Power BI resource accepted by your deployment, contain delegated `Item.Execute.All`, and belong to the target item's owning tenant.
The user must also have Execute permission on that item; app-only tokens are not supported.
The app must have external Entra exchange enabled.

```typescript
import { Auth } from '@microsoft/rayfin-auth';
import { ApiClient } from '@microsoft/rayfin-lib';
import { signInWithEntraToken } from '@microsoft/rayfin-auth-provider-fabric';

const apiClient = new ApiClient({
  baseUrl: rayfinEndpoint,
  publishableKey,
});
const auth = new Auth(apiClient, { storage: false });
auth.attachToClient(apiClient);

try {
  const session = await signInWithEntraToken(auth, { entraToken });
  console.log('Authenticated', session.isAuthenticated);
  // Use SDK clients attached to apiClient here.
} finally {
  auth.destroy();
}
```

This example works in Node.js without browser globals.
`rayfinEndpoint` is the trusted HTTPS AppBackend workload API base URL, including its existing path, not the app's static-hosting URL or a full token endpoint.
Use an absolute HTTPS URL, including for localhost, with no credentials, query string, or fragment; relative proxy bases are not supported.
`entraToken` is the raw token string, without the `Bearer` scheme prefix.
The SDK resolves `/api/auth/v1/brokered/token` against the configured base.
No `FabricAuthOptions`, popup, iframe, PKCE, or return origin is needed.

```typescript
function signInWithEntraToken(
  auth: Auth,
  options: EntraTokenSignInOptions
): Promise<OpaqueSession>;

interface EntraTokenSignInOptions {
  entraToken: string;
}
```

For a `RayfinClient`, pass `client.auth`; it is already attached to the client's HTTP transport.
The returned `OpaqueSession` exposes session metadata, not tokens.
Subsequent authenticated requests and refresh use the Rayfin session, not the Entra token.
The supplied `Auth` instance controls persistence; `storage: false` keeps the session in memory.
Use a separate instance per user on a server and call `auth.destroy()` when it is no longer needed.
`RayfinServerClient` does not expose `auth`; this helper expects a standalone `Auth` or `RayfinClient.auth`, not an access-token callback.

Each explicit call attempts an exchange rather than silently returning a previous session.
Concurrent direct calls on the same `Auth` instance run in invocation order and coordinate with its refresh operations.
Success persists and replaces the session before emitting the login event; failure preserves an existing unexpired in-memory session without treating it as a successful new sign-in.
The helper does not revoke the previous server session.
Failures reject with `AuthError`; do not treat a failed sign-in as authentication of the requested identity.
Browser callers need the service's CORS policy to permit the calling origin and authorization header.
The helper does not acquire Entra tokens, follow exchange redirects, or automatically retry a rejected exchange.

## Browser quick start

For the browser broker experience, the recommended entry point is `ensureSignedInWithFabric()`.

It performs a three-step waterfall:

1. Return the current session if the user is already authenticated.
2. Attempt `auth.refreshSession()` when a refresh token exists.
3. Open the Fabric broker in a popup and complete the handoff flow.

Call it from a synchronous user gesture, such as a button click, because the broker step uses `window.open()`.

The example below reads its configuration from the Vite-projected environment variables the Rayfin CLI emits.
`rayfin up` writes `RAYFIN_PUBLIC_*` values to `rayfin/.env` and, when it detects a Vite or Next.js project, automatically projects them into `.env.local` as the `VITE_*` (or `NEXT_PUBLIC_*`) names shown here.
Run `rayfin env --framework <vite|nextjs|plain>` manually only if you need to regenerate `.env.local` outside those flows or target a framework that can't be auto-detected.

```typescript
import { ApiClient } from '@microsoft/rayfin-lib';
import { Auth } from '@microsoft/rayfin-auth';
import { ensureSignedInWithFabric } from '@microsoft/rayfin-auth-provider-fabric';

const apiClient = new ApiClient({
  baseUrl: import.meta.env.VITE_RAYFIN_API_URL,
  publishableKey: import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY,
});

const auth = new Auth(apiClient);

const fabricOptions = {
  workspaceId: import.meta.env.VITE_FABRIC_WORKSPACE_ID,
  projectId: import.meta.env.VITE_FABRIC_ITEM_ID,
  fabricPortalUrl: import.meta.env.VITE_FABRIC_PORTAL_URL,
  returnOrigin: window.location.origin,
};

document.querySelector('#sign-in')?.addEventListener('click', async () => {
  const session = await ensureSignedInWithFabric(auth, fabricOptions);
  console.log('Authenticated', session.isAuthenticated);
});
```

## Options

`FabricAuthOptions` controls how the broker URL is constructed and how the handoff is returned to your app.

```typescript
interface FabricAuthOptions {
  workspaceId: string;
  projectId: string;
  fabricPortalUrl: string;
  returnOrigin: string;
  callbackUrl?: string;
}
```

`fabricPortalUrl` preserves existing paths and query parameters.

This supports production and development portal URLs such as `https://app.fabric.microsoft.com` or `https://powerbi-df.analysis-df.windows.net?debug.useLocalManifests=1&experience=power-bi`.

## Supported flows

Use `signInWithEntraToken()` when your app already has a delegated Entra token and wants to sign in without a browser broker.

Use `ensureSignedInWithFabric()` when you want silent-session and refresh-token fallback behavior before opening the broker UI.

Use `initiateFabricLogin()` when you only want the broker step and do not need the session and refresh pre-checks.

```typescript
import { initiateFabricLogin } from '@microsoft/rayfin-auth-provider-fabric';

await initiateFabricLogin(auth, {
  workspaceId: '00000000-0000-0000-0000-000000000000',
  projectId: '11111111-1111-1111-1111-111111111111',
  fabricPortalUrl: 'https://app.fabric.microsoft.com',
  returnOrigin: window.location.origin,
});
```

On success, the package exchanges the Fabric handoff code for tokens through the Rayfin auth API and creates the session on your `Auth` instance.

## Legacy callback bridge

Newer broker flows use `postMessage` to send the handoff code back to the opener window.

Older broker flows may redirect the popup to a callback page in your app instead.

For those older flows, call `bridgeFabricCallback()` as early as possible in the callback page.

If the URL contains Fabric handoff parameters, the function forwards them to the opener window and closes the popup.

```typescript
import { bridgeFabricCallback } from '@microsoft/rayfin-auth-provider-fabric';

const bridged = bridgeFabricCallback();

if (!bridged) {
  console.log('No Fabric handoff detected');
}
```

The bridge returns `true` when it handled a Fabric handoff and `false` when the current URL is unrelated.

## Behavior notes

- The browser broker URL is built with PKCE using the `S256` challenge method; direct token sign-in does not use PKCE.
- Existing query parameters on `fabricPortalUrl` are preserved.
- `callbackUrl` defaults to `${returnOrigin}/auth/callback` when omitted.
- The broker handoff waits up to five minutes before timing out.
- If `window.opener` is unavailable in legacy flows, the bridge falls back to `BroadcastChannel`.

## Error handling

The package throws `AuthError` values from `@microsoft/rayfin-lib` for validation and broker failures.

Common cases include missing required options, blocked popups, explicit broker errors, and handoff timeout.

Direct token sign-in reports `INVALID_REQUEST` for invalid local inputs, `EXCHANGE_NOT_ENABLED` for a disabled exchange, `AUTH_FAILED` for token rejection, `INSUFFICIENT_PERMISSIONS` for missing Execute access, and `NOT_AVAILABLE` for an unavailable endpoint.
Transport or other HTTP failures use `TOKEN_EXCHANGE_FAILED`; malformed successful responses use `INVALID_TOKEN_RESPONSE`.
Errors do not include the supplied token or raw server response.
`AUTH_FAILED` and `INSUFFICIENT_PERMISSIONS` alone do not identify an administrator block.
Do not infer that cause from response text.

When direct token exchange explicitly reports an administrator block, the helper rejects with `AuthError`, `code: 'ArtifactBlockedByAdmin'`, and `status: 403`.
Its message is always: "This app has been blocked by your admin. Reach out to the app owner to get unblocked."
An optional `requestId` contains only a validated service correlation GUID; missing or invalid correlation is omitted.
The SDK does not copy the service's message or other diagnostic fields.

Recognition requires an HTTP 403 JSON response with the exact root `code`; an optional `httpStatusCode` must also be `403`.
Failure-body inspection is limited to 16 KiB and one second, or the request timeout if shorter.
Unrecognized, malformed, oversized, or unreadable responses keep the generic failure behavior.
Successful token payloads are read only for authentication, not for error diagnostics.

Normal embedded Fabric handoff also reports `AuthError` with `code: 'ArtifactBlockedByAdmin'` when the parent host returns the exact bridge error code `APP_ADMIN_BLOCKED`.
It uses the same fixed consumer message and omits the host's message and details.
A bridge rejection does not provide an HTTP `status` or a service `requestId`.
Both `embeddedFabricLogin()` and `ensureSignedInWithFabric()` propagate it without exchanging a handoff code for tokens, creating a session, or falling back to a popup.
Other bridge errors retain their existing codes and messages.
The embedded flow's existing identity-based sign-out before handoff is unchanged.

The administrator-block rejection itself does not refresh credentials, retry the rejected request, or discard an existing session.
Session resume surfaces this rejection instead of continuing to a popup login, and refresh backoff preserves the same error code.
Backoff belongs to the current session and is cleared when a replacement session is successfully installed.
The error reports a service rejection; it does not itself change access or unblock the app.

```typescript
import { AuthError } from '@microsoft/rayfin-lib';

try {
  await ensureSignedInWithFabric(auth, fabricOptions);
} catch (error) {
  if (error instanceof AuthError) {
    console.error(error.code, error.message);
    if (error.code === 'ArtifactBlockedByAdmin' && error.requestId) {
      console.error('Request ID', error.requestId);
    }
  }
}
```

## Runtime requirements

The public package entry point and `signInWithEntraToken()` can be imported and used in Node.js without browser globals.
Use memory-only or appropriate custom `Auth` storage outside a browser.

The popup, iframe, and legacy callback helpers remain browser-only.
They depend on browser APIs such as `window.open()`, `postMessage`, `BroadcastChannel`, and `window.location`.
