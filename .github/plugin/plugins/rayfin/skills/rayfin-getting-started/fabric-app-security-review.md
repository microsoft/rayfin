---
name: fabric-app-security-review
description: Review a Fabric App for sensitive data exposure, semantic model security issues, connector risks, and deployment readiness.
---

# Fabric App Security Review

When invoked, perform a security review of the target Fabric App codebase. Focus on whether the app exposes sensitive data to the browser, logs private information, over-fetches from Fabric items, or hardcodes environment-specific configuration.

## Review Steps

1. Review semantic model usage for full-table reads, raw transaction access, unfiltered queries, excessive columns, or queries that return more data than the UI requires.
2. Review React or frontend UI code for PII rendered in the DOM, sensitive props passed between components, or restricted data hidden only with client-side logic.
3. Review API calls for tokens, secrets, workspace IDs, item IDs, tenant IDs, or sensitive query parameters in URLs, request bodies, or logs.
4. Review configuration files such as .env files, manifest.json, app settings, deployment files, and environment configs for hardcoded secrets or identifiers.
5. Review logging and error handling for console.log, console.debug, verbose error objects, stack traces, and debug-only pages that could leak sensitive information.
6. Review connector and Fabric item usage for broad permissions, unnecessary metadata exposure, or environment-specific values that should be resolved securely at runtime.

## Focus Areas

- PII exposure: names, emails, phone numbers, employee data, customer identifiers, salary, financial, or account data.
- Excessive semantic model access: full table retrieval, SELECT-style patterns, raw rows, or large dimensions when measures or aggregates are safer.
- Workspace, item, and tenant ID exposure: identifiers visible in client bundles, URLs, logs, or error messages.
- Client-side filtering: fetching all records and filtering in the browser instead of enforcing least privilege before data reaches the client.
- Debug artifacts: console output, stack traces, temporary debug UI, or commented code that exposes implementation details.

## Output Format

Return findings grouped by Critical, High, Medium, and Low severity. For each finding, include location, issue, why it matters, evidence, recommended fix, and suggested Copilot prompt to remediate it.

## Remediation Guidance

Do not only describe the problem. Recommend a concrete fix, such as moving the filtering server-side, replacing raw data with curated measures, removing logs, moving configuration out of client code, narrowing connector scopes, or using safe error messages.
