---
sidebar_position: 2
---

# Fabric Auth

Fabric authentication lets users sign in to your Rayfin application with their existing Microsoft Entra identity through the Fabric Portal.
No separate login form is needed — users authenticate once in Fabric and your app inherits that session automatically.

The SDK supports three modes:

- **Popup flow** — your app opens the Fabric Portal in a new browser tab, the user authenticates, and the tab closes automatically.
- **Embedded flow** — your app runs inside a Fabric iframe and inherits the session via `postMessage` with no popup, redirect, or user interaction.
- **Direct token flow** — your browser or Node.js app supplies an existing delegated Entra token and establishes a Rayfin session without a browser broker.
  See [Direct Entra token sign-in](./direct-entra-auth.md).

The popup and embedded flows use PKCE S256, `postMessage` origin validation, and state nonces.
The direct flow uses an HTTPS token exchange with delegated-token validation and item-level Execute permission checks.

> **Embedding outside Fabric?** If your app runs inside an iframe on your own third-party portal rather than the Fabric Portal, the portal brokers sign-in with its own Entra token via the parent-page [external embed host](./external-embed-host.md).
> On startup the embedded app posts a one-shot readiness signal and briefly waits for the parent to acknowledge it; if no external embed host answers, the app falls back to the standard Fabric login waterfall described below with no added user-visible delay.

## How it works

### Popup flow

1. Your app opens the Fabric Portal in a new browser tab and registers a `postMessage` listener.
2. The user authenticates through Entra ID inside the Fabric Portal.
3. The Fabric extension sends the handoff code back to your app via `window.top.opener.postMessage()`.
4. The SDK exchanges the handoff code for Rayfin session tokens and creates a session.
5. The Fabric tab is closed automatically.

No callback page or redirect is needed.

### Embedded flow (Fabric iframe)

1. The Fabric Shell loads your app inside an iframe with `?fabricEmbedded=true` in the URL.
2. On startup your app detects embedded mode and calls `initEmbeddedAuth()`.
3. The SDK generates PKCE parameters in memory and sends `auth.requestHandoff` to the parent frame via `postMessage`.
4. The Fabric Extension Host responds with a handoff code.
5. The SDK exchanges the handoff code for Rayfin session tokens and creates a session.

No popup, redirect, or user click is needed.

## Enable Fabric auth

Add the `fabric` section and your app's origin to `rayfin/rayfin.yml`:

```yaml
services:
  auth:
    enabled: true
    allowedRedirectUris:
      - http://localhost:5173
    fabric:
      enabled: true
```

The `allowedRedirectUris` list must include your app's bare origin (e.g. `http://localhost:5173`).
The Fabric brokered auth flow uses the origin as the `postMessage` target for the handoff code.

After changing `rayfin.yml`, redeploy the backend:

```bash
npx rayfin up
```

For a remote deployment, re-deploy to push the updated settings:

```bash
npx rayfin up
```

## Install the provider package

The Fabric auth provider is a separate companion package:

```bash
npm install @microsoft/rayfin-auth-provider-fabric
```

## Client-side usage

### Popup flow: sign in with a button click

Call `ensureSignedInWithFabric` from a user-gesture handler (for example, a button click).
Step 4 of the waterfall calls `window.open()`, so a user gesture is required to avoid popup blockers.

```typescript
import { RayfinClient } from '@microsoft/rayfin-client';
import { ensureSignedInWithFabric } from '@microsoft/rayfin-auth-provider-fabric';

const client = new RayfinClient({
  baseUrl: 'http://localhost:5168',
  publishableKey: 'pk-commonSampleAppKey',
});

async function handleSignIn() {
  const session = await ensureSignedInWithFabric(client.auth, {
    workspaceId: '<your-fabric-workspace-id>',
    projectId: '<your-rayfin-item-id>',
    fabricPortalUrl: 'https://app.fabric.microsoft.com',
    returnOrigin: window.location.origin,
  });
  console.log('Signed in:', session.user);
}
```

### Embedded flow: automatic authentication on startup

Call `initEmbeddedAuth()` once at app startup (for example, in a React `useEffect` or initialization routine).
Use [`initEmbeddedAuthWithResult()`](#initembeddedauthwithresult) instead when the app needs a typed failure result, including administrator-block errors, rather than a failed handoff returning `null`.
Await it before restoring a stored user or rendering authenticated content, even when a persisted session exists.
It is safe to call on every page load: standalone pages return `null` immediately, while framed pages briefly wait for an external embed acknowledgement before choosing the login path.
Keep session-change observers from publishing a stored user while initialization is pending.

```typescript
import { RayfinClient } from '@microsoft/rayfin-client';
import { initEmbeddedAuth } from '@microsoft/rayfin-auth-provider-fabric';

const client = new RayfinClient({
  baseUrl: import.meta.env.VITE_RAYFIN_API_URL,
  publishableKey: import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY,
});

const fabricOptions = {
  workspaceId: import.meta.env.VITE_FABRIC_WORKSPACE_ID,
  projectId: import.meta.env.VITE_FABRIC_ITEM_ID,
  fabricPortalUrl: import.meta.env.VITE_FABRIC_PORTAL_URL,
  returnOrigin: window.location.origin,
};

// Safe to call on every page load — no-op when not embedded.
const session = await initEmbeddedAuth(client.auth, fabricOptions);
if (session) {
  console.log('Embedded session established:', session.user);
}
```

Import `@microsoft/rayfin-auth-provider-fabric` statically in your app entry module rather than only via dynamic `import()`.
The package captures the `?fabricEmbedded=true` URL flag into `sessionStorage` as a side effect at module load, and that must happen on the initial page load before any client-side navigation strips the query string (for example, a post-logout redirect to `/login`).
Do not condition the startup call on the absence of a stored session; that bypasses the SDK's identity check and external embed handshake.

### Detecting embedded mode

The SDK detects embedded mode when any of these conditions is true:

- The `fabricEmbedded` option is set to `true` in `FabricAuthOptions`.
- The URL contains the `?fabricEmbedded=true` query parameter.
- A previous call already stored the flag in `sessionStorage`.

You can check this manually:

```typescript
import { isEmbeddedMode } from '@microsoft/rayfin-auth-provider-fabric';

const embedded = isEmbeddedMode({
  workspaceId: '...',
  projectId: '...',
  fabricPortalUrl: '...',
  returnOrigin: window.location.origin,
});
```

### Supporting both flows

Most apps should support both embedded mode (iframe) and the popup flow (standalone browser).
`ensureSignedInWithFabric()` handles this automatically — it tries embedded auth first, then falls back to the popup:

1. Return existing session if already authenticated.
2. Attempt refresh via refresh token.
3. If embedded mode is detected, use `postMessage` handoff (no popup).
4. Otherwise, open the Fabric Portal in a new tab and wait for the handoff.

For page-load initialization (no user gesture), use `initEmbeddedAuth()` instead.
It skips step 4 and returns `null` when no embedded session is available.

### React hook example

```typescript
import { useState, useCallback } from 'react';
import { ensureSignedInWithFabric } from '@microsoft/rayfin-auth-provider-fabric';
import { client } from './lib/rayfin';

const fabricOptions = {
  workspaceId: import.meta.env.VITE_FABRIC_WORKSPACE_ID,
  projectId: import.meta.env.VITE_FABRIC_ITEM_ID,
  fabricPortalUrl: import.meta.env.VITE_FABRIC_PORTAL_URL,
  returnOrigin: window.location.origin,
};

export function useFabricAuth() {
  const [session, setSession] = useState(client.auth.getSession());

  const signIn = useCallback(async () => {
    const result = await ensureSignedInWithFabric(client.auth, fabricOptions);
    setSession(result);
    return result;
  }, []);

  return {
    session,
    signIn,
    isAuthenticated: session?.isAuthenticated ?? false,
  };
}
```

## API reference

### ensureSignedInWithFabric

```typescript
function ensureSignedInWithFabric(
  auth: Auth,
  options: FabricAuthOptions
): Promise<OpaqueSession>;
```

The primary API.
Implements a four-step waterfall where the first successful step short-circuits the rest:

1. **Already authenticated** — returns the existing session.
2. **Refresh token** — attempts to refresh the session silently.
3. **Embedded mode** — if running inside a Fabric iframe (`fabricEmbedded=true`), uses `postMessage` to acquire a session without a popup.
4. **Open Fabric broker** — opens the Fabric Portal in a new tab, listens for the handoff code via `postMessage`, exchanges the code for tokens, and creates a session.

Steps 1–3 are safe to call on page load.
Step 4 opens a new browser tab and must run inside a user-gesture handler.

### initEmbeddedAuth

```typescript
function initEmbeddedAuth(
  auth: Auth,
  options: FabricAuthOptions
): Promise<OpaqueSession | null>;
```

Call once at app startup.
Returns the authenticated session when running in embedded mode, or `null` when not embedded.
Never opens a popup or new tab — safe for page-load use.

**Waterfall:**

1. Return existing session if authenticated.
2. Attempt refresh via refresh token.
3. Request handoff from the parent frame via `postMessage` and exchange for tokens.

### initEmbeddedAuthWithResult

```typescript
function initEmbeddedAuthWithResult(
  auth: Auth,
  options: FabricAuthOptions
): Promise<EmbeddedAuthResult>;

type EmbeddedAuthResult =
  | { status: 'authenticated'; session: OpaqueSession }
  | { status: 'not-embedded' }
  | { status: 'error'; error: SdkError };
```

An opt-in startup companion to `initEmbeddedAuth()` that never opens a popup or renders UI.
It covers embedded-mode detection, external-host classification, session resume, and handoff through session creation.
`authenticated` supplies the opaque session; `not-embedded` is a no-op; `error` supplies a sanitized typed failure for the embedded app to handle.
Generic refresh failures retain the existing fallback to handoff rather than becoming terminal results.

The error preserves the `AuthError`, `NetworkError`, or `SdkError` category and a valid machine-readable code.
It is a new error object with a fixed message, optional valid HTTP status, and optional GUID request identifier; raw responses, original messages, causes, and custom details are omitted.
`ArtifactBlockedByAdmin` retains its fixed consumer message, other failures use "Embedded Fabric authentication failed.", and unknown exceptions or invalid codes use `EMBEDDED_AUTH_FAILED`.
Handoff completion without an authenticated session uses `SESSION_NOT_ESTABLISHED`.
Error codes are limited to 128 ASCII letters, digits, or underscores, starting with a letter.

The existing `initEmbeddedAuth()` signature and behavior are preserved, including `null` for failed handoffs and any existing pre-handoff promise rejections.
The new function captures those pre-handoff failures into its `error` outcome as well.
The embedded app owns error presentation; the external parent broker remains headless.

### initiateFabricLogin

```typescript
function initiateFabricLogin(
  auth: Auth,
  options: FabricAuthOptions
): Promise<void>;
```

Low-level function that opens the Fabric Portal and listens for the postMessage handoff.
Called internally by `ensureSignedInWithFabric` in step 4.
Most apps should use `ensureSignedInWithFabric` instead.

### FabricAuthOptions

| Property          | Type                 | Description                                                                                                          |
| ----------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `workspaceId`     | `string`             | The Fabric workspace ID.                                                                                             |
| `projectId`       | `string`             | The Rayfin item ID (AppBackend artifact ID).                                                                         |
| `fabricPortalUrl` | `string`             | The Fabric Portal base URL (for example, `https://app.fabric.microsoft.com`).                                        |
| `returnOrigin`    | `string`             | Your app's origin (for example, `window.location.origin`). Used as the `postMessage` target origin.                  |
| `fabricEmbedded`  | `boolean` (optional) | When `true`, force embedded mode. The SDK also auto-detects embedded mode when `?fabricEmbedded=true` is in the URL. |

## Security

- **PKCE S256** — The popup and embedded flows generate a cryptographic code verifier and challenge to prevent authorization code interception.
- **State nonce** — A random nonce ties the postMessage response to the originating flow, preventing CSRF.
- **In-closure code verifier** — The PKCE `code_verifier` is held in memory (closure) and never persisted to localStorage.
- **Origin validation** — The SDK validates `event.origin` on incoming messages against `fabricPortalUrl`.
  The Fabric extension uses an explicit `targetOrigin` (not `"*"`) when sending the handoff code.
- **Flow timeout** — The flow times out after 5 minutes if no postMessage is received.
- **Session isolation** — In embedded mode, the iframe's `localStorage` stores the session tokens, isolated from the parent frame by the browser's same-origin policy.

## Environment variables

Fabric auth requires three Vite environment variables so your frontend can build the `FabricAuthOptions` at runtime.
`npx rayfin dev` writes the underlying `RAYFIN_PUBLIC_*` values to `rayfin/.env` and maps them to Vite-compatible names in `.env.local` before starting the frontend.
Production builds retain the scaffolded `prebuild` hook to refresh those values before bundling.

| Source variable (`rayfin/.env`) | Vite variable (`.env.local`) | Description                                                            | Example                                |
| ------------------------------- | ---------------------------- | ---------------------------------------------------------------------- | -------------------------------------- |
| `RAYFIN_PUBLIC_ITEM_ID`         | `VITE_FABRIC_ITEM_ID`        | The Fabric item ID (Fabric data app artifact ID). Maps to `projectId`. | `21b98705-08d5-448c-ab32-d88a3d00af41` |
| `RAYFIN_PUBLIC_WORKSPACE_ID`    | `VITE_FABRIC_WORKSPACE_ID`   | The Fabric workspace ID. Maps to `workspaceId`.                        | `b80c0e39-468a-4742-8f0a-458dc6b1c918` |
| `RAYFIN_PUBLIC_PORTAL_URL`      | `VITE_FABRIC_PORTAL_URL`     | The Fabric Portal base URL. Maps to `fabricPortalUrl`.                 | `https://app.fabric.microsoft.com/`    |

For local development, add these to `rayfin/.env`:

```text
RAYFIN_PUBLIC_ITEM_ID=<your-rayfin-item-id>
RAYFIN_PUBLIC_WORKSPACE_ID=<your-fabric-workspace-id>
RAYFIN_PUBLIC_PORTAL_URL=https://app.fabric.microsoft.com/
```

Then read them in your application code:

```typescript
const fabricOptions = {
  workspaceId: import.meta.env.VITE_FABRIC_WORKSPACE_ID,
  projectId: import.meta.env.VITE_FABRIC_ITEM_ID,
  fabricPortalUrl: import.meta.env.VITE_FABRIC_PORTAL_URL,
  returnOrigin: window.location.origin,
};
```

## Deployment values

After running `npx rayfin dev` or `npx rayfin up`, the CLI records deployment metadata in `rayfin/.deployments.json` and merges the corresponding `RAYFIN_PUBLIC_*` variables into `rayfin/.env`:

```text
RAYFIN_PUBLIC_ITEM_ID=<guid>
RAYFIN_PUBLIC_WORKSPACE_ID=<guid>
RAYFIN_PUBLIC_PORTAL_URL=https://app.fabric.microsoft.com/
```

`rayfin dev` generates `.env.local` with Vite-compatible names before starting the frontend.
Use `RAYFIN_PUBLIC_ITEM_ID` as the `projectId` and `RAYFIN_PUBLIC_WORKSPACE_ID` as the `workspaceId` in your `FabricAuthOptions`.

## Troubleshooting

- **Popup blocked** — Call `ensureSignedInWithFabric` from a synchronous user-gesture handler (for example, a button `onClick`).
  Calling it on page load or inside an `async` chain before the user clicks triggers popup blockers.
- **Session not persisting** — Confirm the `RayfinClient` is configured with the correct `baseUrl` and `publishableKey`.
- **Timeout after 5 minutes** — The handoff code was not received.
  Check that `returnOrigin` matches your app's actual origin and that the Fabric extension is sending to the correct origin.
- **Origin mismatch** — The `fabricPortalUrl` origin must match the origin of the Fabric Portal tab.
  Verify you are using the correct URL for your environment (production, PPE, or dev).
- **`initEmbeddedAuth` returns `null`** — Ensure the URL contains `?fabricEmbedded=true` or set `fabricEmbedded: true` in the options.
- **Embedded handoff timeout** — The parent frame did not respond.
  Verify that `returnOrigin` matches the iframe's actual origin.
- **State mismatch error** — The response state did not match the request.
  This can indicate a replay attack or a stale response from a previous flow.
