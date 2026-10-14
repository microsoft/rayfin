---
symbols: []
---

# @microsoft/rayfin-lib

Shared HTTP and client utilities used by higher-level Rayfin SDKs.

This package ships its own docs via the `rayfinDocs` field convention
(see [docs-package-architecture](https://github.com/microsoft/project-rayfin/tree/main/openspec/changes/docs-package-architecture)).
For the full TypeDoc reference, see the bundled docs at
`ts-sdk/@microsoft/rayfin-lib/` accessible via `rayfin docs list --module ts-sdk`.

## Installation

```bash
npm install @microsoft/rayfin-lib
```

## Quickstart

This stub will expand in follow-up PRs as per-package docs are authored.
The Phase 2 + Phase 3 milestone for this package is the package-level
convention contract: declare `rayfinDocs` in `package.json`, ship a
`assets/docs/` directory, let `@microsoft/rayfin-docs` discover it
automatically.

## Administrator-block errors

`ApiClient` reports a recognized service administrator-block rejection as a `NetworkError` with `code: 'ArtifactBlockedByAdmin'` and `status: 403`.
Authentication helpers preserve the same code and status in an `AuthError`.
Both error types expose an optional readonly `requestId` containing a validated service correlation GUID.
No raw response, embedded diagnostics, or service-provided message is attached to this rejection.

The fixed message is: "This app has been blocked by your admin. Reach out to the app owner to get unblocked."
Branch on the exact error code, not the message or a generic 401/403 status.
The SDK recognizes only the exact root code in a bounded HTTP 403 JSON response, and does not automatically refresh credentials or retry that rejection.
