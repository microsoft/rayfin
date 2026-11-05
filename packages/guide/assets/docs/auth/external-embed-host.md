---
sidebar_position: 3
---

# External embed host

The external embed host lets a **third-party portal** embed a Rayfin app in an iframe and sign the user in with the portal's own Microsoft Entra identity.
Use it when your app is hosted outside the Fabric Portal — a standalone web app, an internal tool, or any page that already holds a delegated Entra token — and you want to broker authentication for an embedded Rayfin app without a popup or redirect.

This is the parent-page counterpart to [Fabric brokered auth](./fabric.md).
Fabric auth signs a Rayfin app in when Fabric hosts it; the external embed host signs it in when _your_ page hosts it.

The parent page holds a delegated Entra token and answers the embedded app's handoff request.
The embedded app never sees the token — it receives only a single-use handoff code that it exchanges for a Rayfin session.

## When to use it

Use `@microsoft/rayfin-embed-host` when **all** of these are true:

- Your page embeds a Rayfin app in an iframe.
- Your page is not the Fabric Portal, so the in-Fabric embed host is unavailable.
- Your page can obtain a delegated Entra access token for the signed-in user.

If your app runs inside the Fabric Portal iframe, use [Fabric brokered auth](./fabric.md) instead — you do not need this package.

## How it works

1. Your page calls `createEmbedHost()` and then mounts the Rayfin app in an iframe.
2. The embedded app calls `initEmbeddedAuthWithResult()` (or legacy `initEmbeddedAuth()`) on startup and posts a one-shot readiness signal to the parent window.
3. The host checks the iframe's origin against `allowedOrigins` and replies with an acknowledgement, classifying the scenario as an external embed.
4. The embedded app signs out, then sends a correlated handoff request carrying its brokered-authorize endpoint URL, its Fabric artifact id, the return origin, and a PKCE challenge.
5. The host validates the return origin against `allowedOrigins`, calls `getAccessToken()` to obtain your delegated Entra token, and posts it to the app's `brokered/authorize/external` endpoint.
6. The endpoint returns a single-use handoff code, which the host sends back to the iframe in the correlated response.
7. The embedded app exchanges the handoff code for a Rayfin session — the user is signed in with no popup, redirect, or user click.

The readiness signal is sent **once** with no retry.
Register the host before you mount the iframe so the listener is live when the signal arrives.

The external embed scenario is detected from this acknowledgement alone — the embedded Rayfin app needs no special query flag (such as `fabricEmbedded`) to enter external embed mode.
The embedded app must await its startup helper before restoring a stored user or rendering authenticated content.
Do not skip this call when `auth.getSession()` already reports an authenticated session: that session may belong to a different user than the parent portal's current user.

If no host acknowledges the readiness signal, the embedded app falls back to its normal Fabric login waterfall, so a page that never calls `createEmbedHost()` is unaffected.

## Install

```bash
npm install @microsoft/rayfin-embed-host
```

## Register the host before mounting the iframe

Call `createEmbedHost()` before the Rayfin iframe loads.
The embedded app emits its readiness signal once, immediately on startup, and there is no retry — if the listener is not yet registered, the handshake is missed and the app falls back to its normal login flow.

```typescript
import { createEmbedHost } from '@microsoft/rayfin-embed-host';

// Register BEFORE mounting the Rayfin iframe.
const host = createEmbedHost({
  allowedOrigins: ['https://my-rayfin-app.example.com'],
  getAccessToken: () => acquireDelegatedEntraToken(),
});

// Now mount the iframe pointing at the embedded Rayfin app.
const iframe = document.createElement('iframe');
iframe.src = 'https://my-rayfin-app.example.com';
document.querySelector('#app-embed')?.append(iframe);

// When the embed is torn down:
host.dispose();
```

## Observe startup errors in the embedded app

The embedded app, not the parent portal, owns error observation and presentation.
Call `initEmbeddedAuthWithResult()` in the iframe to receive a discriminated outcome:

```typescript
import { initEmbeddedAuthWithResult } from '@microsoft/rayfin-auth-provider-fabric';

const result = await initEmbeddedAuthWithResult(client.auth, fabricOptions);
if (result.status === 'authenticated') {
  startApp(result.session);
} else if (result.status === 'error') {
  showAuthenticationError(result.error.code);
} else {
  showStandaloneSignIn();
}
```

The rendering functions are application-owned.
An error result contains a sanitized SDK error whose code distinguishes failures such as `ArtifactBlockedByAdmin`, `INSUFFICIENT_PERMISSIONS`, and `BRIDGE_TIMEOUT`.
The helper preserves the SDK error category and safe status/correlation metadata, not arbitrary host messages, raw responses, or custom diagnostic fields.
Unexpected exceptions use `EMBEDDED_AUTH_FAILED`.
`createEmbedHost()` remains a headless broker; no parent-side error UI or callback is required.

Legacy `initEmbeddedAuth()` retains its session-or-`null` contract for failed handoffs and non-embedded pages.
Use the new API when startup needs fine-grained error handling rather than treating those outcomes as the same `null`.
See [Fabric auth](./fabric.md#initembeddedauthwithresult) for the complete result type and compatibility notes.

## Options

`createEmbedHost()` takes an `EmbedHostOptions` object.

| Property         | Type                              | Description                                                                                                                                                                                                                                                        |
| ---------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `allowedOrigins` | `string[]`                        | Origins of the embedded Rayfin app(s) this host brokers for. Set it to your app's URL origin(s), for example `https://my-rayfin-app.example.com`. The same list gates both the iframe that sends the handshake and the return origin the handoff code is bound to. |
| `getAccessToken` | `() => string \| Promise<string>` | Yields your page's delegated Entra access token. Invoked once per handoff request; the returned token is attached only to the outbound authorization call and is never cached across requests.                                                                     |

## Providing the access token

`getAccessToken` is your integration point with your page's identity stack.
Return the delegated Entra access token for the currently signed-in user — for example, from MSAL's `acquireTokenSilent`, a server-side session endpoint, or whatever token cache your portal already uses.

```typescript
const host = createEmbedHost({
  allowedOrigins: ['https://my-rayfin-app.example.com'],
  getAccessToken: async () => {
    const result = await msalInstance.acquireTokenSilent({
      scopes: ['<your-api-scope>'],
      account: msalInstance.getActiveAccount()!,
    });
    return result.accessToken;
  },
});
```

The host calls `getAccessToken()` fresh for every handoff request, so returning a short-lived token is fine — you do not need to cache one yourself.

## Cleanup

`createEmbedHost()` registers a `message` listener on the parent window.
Call `dispose()` when you remove the iframe (for example, on route change or component unmount) to remove the listener and stop brokering handoffs.
`dispose()` is idempotent.

```typescript
host.dispose();
```

## Security

- **Single origin allowlist** — `allowedOrigins` gates both the browser-attested `event.origin` of the iframe that posts the handshake and handoff request, and the `returnOrigin` the handoff code is bound to.
  Messages from any other origin are ignored, and a request naming a return origin outside the list is rejected before any network call.
- **Token never leaves the parent** — The delegated Entra token is attached only to the outbound `brokered/authorize/external` call.
  It is never sent over the `postMessage` bridge and never returned to the iframe.
- **PKCE S256** — The embedded app generates the PKCE challenge; the handoff code is bound to it and is single-use.
- **Correlated responses** — Each handoff response is matched to its request by a correlation id, so a response is only delivered to the request that asked for it.

## Troubleshooting

- **The app keeps its stored session without signing out or calling the external endpoint** — Check the embedded app's startup ordering.
  Call and await `initEmbeddedAuthWithResult()` or legacy `initEmbeddedAuth()` before checking for a stored user; importing the provider package alone does not start authentication.
- **The app falls back to a popup or normal Fabric login** — The readiness signal was missed.
  Confirm `createEmbedHost()` runs before the iframe is mounted, and that the iframe's origin is listed in `allowedOrigins`.
- **Handoff request rejected before any network call** — The request's return origin is not in `allowedOrigins`.
  Add the embedded app's exact origin (scheme, host, and port) to the list.
- **Authorization call fails** — Verify `getAccessToken()` returns a valid delegated Entra token with the scope your app's `brokered/authorize/external` endpoint expects.
- **Nothing happens after mounting the iframe** — Confirm the embedded Rayfin app is built with an external-Entra-enabled auth provider (see [Fabric brokered auth](./fabric.md) for the iframe side).
