import { describe, expect, it } from "vitest";

import {
  resolveDocsMarkdown,
  sanitizeDocsMarkdownForPublish,
} from "../visibility.js";

const flag = "functions-experimental-auth";
const registeredFlags = [flag];

describe("docs visibility resolver", () => {
  it("selects the experimental branch when enabled", () => {
    const result = resolveDocsMarkdown(
      `:::experimental{flag=${flag}}

## Brokered authentication

Gated-only text.
:::else

Legacy-only text.
:::
`,
      { enabledFlags: [flag], registeredFlags, sourcePath: "functions.md" },
    );

    expect(result).toContain("Brokered authentication");
    expect(result).toContain("Gated-only text.");
    expect(result).not.toContain("Legacy-only text.");
    expect(result).not.toContain(":::experimental");
  });

  it("selects only the else branch when disabled", () => {
    const result = resolveDocsMarkdown(
      `:::experimental{flag=${flag}}

Experimental secret.
:::else

Public fallback.
:::
`,
      { registeredFlags, sourcePath: "functions.md" },
    );

    expect(result).toContain("Public fallback.");
    expect(result).not.toContain("Experimental secret.");
  });

  it("removes private regions regardless of flag state", () => {
    const result = resolveDocsMarkdown(
      `Public text.

:::private{flag=${flag}}

Private secret.
:::
`,
      { enabledFlags: [flag], registeredFlags, sourcePath: "functions.md" },
    );

    expect(result).toContain("Public text.");
    expect(result).not.toContain("Private secret.");
  });

  it("strips private package content while preserving experimental regions", () => {
    const sanitized = sanitizeDocsMarkdownForPublish(
      `Public text.

:::private{flag=${flag}}

Private secret.
:::

:::experimental{flag=${flag}}

Experimental feature.
:::
`,
      { registeredFlags, sourcePath: "functions.md" },
    );

    expect(sanitized).not.toContain("Private secret.");
    expect(sanitized).toContain(":::experimental");
    expect(
      resolveDocsMarkdown(sanitized, {
        enabledFlags: [flag],
        registeredFlags,
      }),
    ).toContain("Experimental feature.");
  });

  it("preserves marker-like content inside fenced code blocks", () => {
    const source = `\`\`\`md
:::experimental{flag=not-a-real-flag}
example
:::
\`\`\`
`;

    expect(resolveDocsMarkdown(source, { registeredFlags })).toBe(source);
  });

  it.each([
    [
      `:::experimental{flag=missing}\n\nSecret.\n:::\n`,
      /functions\.md:1: Unknown documentation feature flag 'missing'/,
    ],
    [
      `:::experimental\n\nSecret.\n:::\n`,
      /functions\.md:1: :::experimental requires exactly one non-empty flag attribute/,
    ],
    [
      `:::experimental{flag=${flag}}\n\nSecret.\n`,
      /functions\.md:1: Unclosed :::experimental region/,
    ],
    [
      `:::else\n\nFallback.\n:::\n`,
      /functions\.md:1: :::else must be inside :::experimental/,
    ],
    [
      `:::private{flag=${flag}}\n\nSecret.\n:::else\n\nPublic.\n:::\n`,
      /functions\.md:4: :::private does not support :::else/,
    ],
    [
      `:::experimental{flag=${flag}}\n\n:::experimental{flag=${flag}}\nNested.\n:::\n:::\n`,
      /Nested :::experimental regions are not supported/,
    ],
  ])("fails closed for malformed or unregistered markers", (source, error) => {
    expect(() =>
      resolveDocsMarkdown(source, {
        registeredFlags,
        sourcePath: "functions.md",
      }),
    ).toThrow(error);
  });
});
