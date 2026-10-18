import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { getDocsExcludedByFlags } from "./doc-visibility";

test("whole-document flag metadata excludes pages unless the flag is enabled", () => {
  const root = mkdtempSync(join(tmpdir(), "rayfin-doc-visibility-"));
  try {
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "public.md"), "# Public\n");
    writeFileSync(
      join(root, "nested", "gated.mdx"),
      "---\nflags:\n  - auth-preview\n---\n# Gated\n",
    );

    assert.deepEqual(getDocsExcludedByFlags(root, [], ["auth-preview"]), [
      "nested/gated.mdx",
    ]);
    assert.deepEqual(
      getDocsExcludedByFlags(root, ["auth-preview"], ["auth-preview"]),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("whole-document flag metadata rejects unregistered flags", () => {
  const root = mkdtempSync(join(tmpdir(), "rayfin-doc-visibility-"));
  try {
    writeFileSync(
      join(root, "gated.md"),
      "---\nflags: unknown-flag\n---\n# Gated\n",
    );

    assert.throws(
      () => getDocsExcludedByFlags(root, [], ["auth-preview"]),
      /Unknown documentation feature flag 'unknown-flag'/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
