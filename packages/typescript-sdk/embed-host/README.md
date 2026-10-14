# @microsoft/rayfin-embed-host

Parent-page SDK for embedding a Rayfin app in an iframe and brokering its
external-Entra authentication.

A third-party portal that embeds a Rayfin app cannot use the in-Fabric embed
host — it has no Fabric project context and no per-app configuration. This
package lets such a portal act as the auth broker: it answers the embedded
app's readiness handshake, validates each handoff request against a
parent-supplied trust boundary, and exchanges it for a handoff code by calling
the app's `brokered/authorize/external` endpoint with the **parent's own
delegated Entra token**.

## Usage

```typescript
import { createEmbedHost } from '@microsoft/rayfin-embed-host';

// Register BEFORE mounting the Rayfin iframe so the listener is live when the
// iframe emits its single readiness signal.
const host = createEmbedHost({
  allowedOrigins: ['https://my-rayfin-app.example.com'],
  getAccessToken: () => acquireDelegatedEntraToken(),
});

// When the embed is torn down:
host.dispose();
```

`allowedOrigins` is the origin allowlist for the embedded Rayfin app(s).
The same list gates both the browser-attested `event.origin` of the iframe that
sends the handshake and handoff request, and the `returnOrigin` the handoff code
is bound to — in the supported topology the iframe both requests and redeems the
handoff, so those are the same value.

`getAccessToken` is invoked once per handoff request; the token is attached only
to the outbound authorization call and is never cached or echoed back over the
bridge.

## Administrator-block errors

The default handoff provider recognizes an administrator block only from an HTTP 403 JSON response whose root `code` is exactly `ArtifactBlockedByAdmin`.
If `httpStatusCode` is present, it must also be numeric `403`.
Inspection is bounded to 16 KiB and one second; malformed, unreadable, oversized, redirected, or unrecognized responses keep the existing generic error mapping.
Generic HTTP 403 responses remain `INSUFFICIENT_PERMISSIONS`.

`createEmbedHost()` forwards the recognized rejection to the iframe as `ArtifactBlockedByAdmin` with the fixed message: "This app has been blocked by your admin. Reach out to the app owner to get unblocked."
It does not forward backend messages, nested diagnostics, tokens, or service correlation details.
The iframe auth provider preserves this code and message in an `AuthError` rather than exchanging a handoff code or creating a session.
Consumers should branch on the stable code rather than parse message text.
