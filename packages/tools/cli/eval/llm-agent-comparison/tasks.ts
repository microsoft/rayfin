/**
 * Task definitions for the LLM-agent comparison eval.
 *
 * Each task is an *agent task* — a natural-language prompt the agent receives
 * plus a programmatic correctness predicate the harness applies to the
 * agent's final answer.
 *
 * The rubber-duck pass on this design (PR #1143 round 5) explicitly called
 * out that pure keyword/citation matching is too weak — it false-passes
 * citation-stuffed answers and false-fails graceful failures on negative
 * tasks. Each task therefore carries a `validate` function that encodes the
 * task-specific success criteria, plus a `kind` distinguishing answerable
 * questions from negative/unknown-territory ones.
 *
 * Start with three tasks (one per tier) so the pipeline can be validated
 * before scaling. The scoring framework supports more tasks; add them once
 * the eval shape is shown to be useful.
 */

import { type DocsToolCall } from './adapter.js';

export type TaskKind = 'answerable' | 'negative';
export type TaskSource = 'manual' | 'github-issue' | 'discord' | 'docs-derived';
export type TaskTier =
  | 'factual' // 1-2 tool calls
  | 'synthesis' // 2-4 tool calls, multi-doc
  | 'symbol' // signature / shape lookup
  | 'negative'; // unknown-territory / not in default modules

export interface ValidationContext {
  /** The agent's final natural-language answer (text only, no tool calls). */
  answer: string;
  /** All tool calls the agent made during the task. */
  toolCalls: DocsToolCall[];
  /** Whether the agent successfully terminated (vs hit a turn/token cap). */
  terminated: boolean;
}

export interface ValidationResult {
  /** 0.0-1.0; \>=0.75 = passed. */
  score: number;
  /** Human-readable reasoning for the score. */
  notes: string[];
  /** Programmatic tags for failure categorization (used by the orchestrator). */
  tags: string[];
}

export interface Task {
  id: string;
  tier: TaskTier;
  kind: TaskKind;
  source: TaskSource;
  /** The natural-language prompt the agent receives. */
  prompt: string;
  /** Programmatic correctness check applied to the final answer + tool trace. */
  validate: (ctx: ValidationContext) => ValidationResult;
}

/**
 * Helper: case-insensitive substring presence in `answer` for any of the
 * provided needles. Returns the matched needles for reporting.
 */
function findAny(answer: string, needles: string[]): string[] {
  const lower = answer.toLowerCase();
  return needles.filter((n) => lower.includes(n.toLowerCase()));
}

function findAll(answer: string, needles: string[]): string[] {
  return findAny(answer, needles);
}

/**
 * T1 — factual lookup: agent should land on the dev-quickstart guide and
 * cite the `npm run dev` (or equivalent) command.
 */
const T1_DEV_COMMAND: Task = {
  id: 'factual-dev-command',
  tier: 'factual',
  kind: 'answerable',
  source: 'manual',
  prompt:
    'What single command should I run to start local Rayfin development against my generated app? Cite the doc you used.',
  validate: ({ answer, toolCalls, terminated }) => {
    const tags: string[] = [];
    const notes: string[] = [];
    if (!terminated) {
      tags.push('turn-cap-hit');
      return { score: 0, notes: ['agent did not terminate'], tags };
    }

    // Required: mention the actual command. The repo's quickstart runs
    // `rayfin dev` (or `npm run dev` which delegates to it). Accept either.
    const commandHits = findAny(answer, [
      'rayfin dev',
      'npm run dev',
      'rushx dev',
    ]);
    if (commandHits.length === 0) {
      tags.push('missing-command');
      notes.push(
        "answer does not mention any of: 'rayfin dev', 'npm run dev', 'rushx dev'"
      );
    } else {
      notes.push(`mentions command: ${commandHits.join(', ')}`);
    }

    // Required: cite a doc id or path. Accept package doc ids plus the
    // legacy guide path forms from older result snapshots.
    const citationHits = findAny(answer, [
      'rayfin-guide:',
      'guide:',
      'docs/guide/',
      'guide/cli/',
      'guide/getting-started/',
      'guide/auth/',
      'guide/data/',
      'guide/app-backend/',
      'guide/hosting/',
    ]);
    if (citationHits.length === 0) {
      tags.push('missing-citation');
      notes.push('answer does not cite any guide doc');
    }

    // Forbidden: claim host-only fact.
    if (/microsoft\.rayfin\./i.test(answer)) {
      tags.push('forbidden-host-claim');
      notes.push('answer references .NET host types — not relevant to dev');
    }

    let score = 0;
    if (commandHits.length > 0) score += 0.6;
    if (citationHits.length > 0) score += 0.4;
    if (tags.includes('forbidden-host-claim')) score = Math.max(0, score - 0.5);

    // Bonus for efficient tool use: penalize >4 tool calls on a factual.
    if (toolCalls.length > 4) {
      tags.push('excess-tool-calls');
      notes.push(`${toolCalls.length} tool calls for a factual task`);
    }

    return { score: Math.min(1, score), notes, tags };
  },
};

/**
 * T2 — synthesis: agent should pull from auth + magic-link docs and answer
 * with both the SDK call and the redirect mechanism. Tests the agent's
 * ability to combine info from multiple docs.
 */
const T2_MAGIC_LINK_SYNTHESIS: Task = {
  id: 'synthesis-magic-link-react',
  tier: 'synthesis',
  kind: 'answerable',
  source: 'manual',
  prompt:
    'How do I sign a user in with a magic link in a React app, and redirect them to a specific URL after the link is verified? Show the SDK call and the option used for redirection. Cite the docs you used.',
  validate: ({ answer, toolCalls, terminated }) => {
    const tags: string[] = [];
    const notes: string[] = [];
    if (!terminated) {
      tags.push('turn-cap-hit');
      return { score: 0, notes: ['agent did not terminate'], tags };
    }

    // Must mention the SDK function name (case-insensitive).
    const fnHits = findAll(answer, ['signInWithMagicLink', 'magicLink']);
    // Must mention the redirect option name (substring).
    const redirectHits = findAll(answer, [
      'redirectUri',
      'redirectUrl',
      'redirect uri',
      'redirect url',
    ]);
    // Must cite an auth or ts-sdk doc. Accept all three citation styles
    // (CLI/MCP `module:`, full path, or raw-docs relative path).
    const citationHits = findAll(answer, [
      'auth/magic-link',
      'rayfin-auth:',
      'guide:docs/guide/auth',
      'docs/guide/auth',
      'guide/auth/',
      'ts-sdk:',
      'ts-sdk/@microsoft/rayfin-auth',
      'rayfin-auth/',
    ]);

    if (fnHits.length === 0) {
      tags.push('missing-sdk-call');
      notes.push('answer does not mention signInWithMagicLink / magicLink');
    }
    if (redirectHits.length === 0) {
      tags.push('missing-redirect-option');
      notes.push('answer does not mention a redirect option');
    }
    if (citationHits.length === 0) {
      tags.push('missing-citation');
      notes.push('answer does not cite an auth doc');
    }

    let score = 0;
    if (fnHits.length > 0) score += 0.4;
    if (redirectHits.length > 0) score += 0.3;
    if (citationHits.length > 0) score += 0.3;

    // Tool-use efficiency: synthesis should use 2-4 tool calls; <2 is
    // suspicious (didn't read enough); >6 is a thrashing sign.
    if (toolCalls.length < 2) {
      tags.push('under-researched');
      notes.push(`only ${toolCalls.length} tool call(s) for synthesis task`);
    } else if (toolCalls.length > 6) {
      tags.push('excess-tool-calls');
      notes.push(`${toolCalls.length} tool calls for synthesis task`);
    }

    return { score: Math.min(1, score), notes, tags };
  },
};

/**
 * T3 — negative / unknown-territory: the agent should gracefully report
 * that the answer isn't in the docs corpus rather than hallucinate. We
 * deliberately pick a topic that's NOT in Rayfin docs (Stripe payment
 * integration). Two acceptable success modes:
 *   (a) Agent searches, finds nothing relevant, and reports the gap
 *       honestly ("not in the Rayfin docs", "couldn't find", etc.).
 *   (b) Agent retrieves the small handful of false-positive search hits
 *       and explains why they don't actually answer the question.
 * Failure modes: agent fabricates a Rayfin Stripe integration, or claims
 * the answer is in docs without citing them.
 *
 * Earlier round used a host-docs negative ("MagicLinkSettings on .NET
 * host"). Per user direction (round 5b), host docs are not a critical
 * path for this PR, so the negative-task scenario was changed to a
 * topic genuinely absent from the corpus.
 */
const T3_OUT_OF_SCOPE: Task = {
  id: 'negative-stripe-payments',
  tier: 'negative',
  kind: 'negative',
  source: 'manual',
  prompt:
    "How do I integrate Stripe payments into a Rayfin app? If the docs you can search don't cover this, say so explicitly rather than guessing.",
  validate: ({ answer, toolCalls, terminated }) => {
    const tags: string[] = [];
    const notes: string[] = [];
    if (!terminated) {
      tags.push('turn-cap-hit');
      return { score: 0, notes: ['agent did not terminate'], tags };
    }

    // Path: agent gracefully reports the gap.
    const gapPhrases = findAny(answer, [
      'not in',
      'not available',
      'not covered',
      'not present',
      'no docs',
      'no documentation',
      "couldn't find",
      'could not find',
      "i don't see",
      "i don't have",
      "doesn't appear",
      "isn't covered",
      "doesn't cover",
      "don't cover",
      'no mention',
      'out of scope',
      'no relevant',
      'no rayfin-specific',
    ]);

    // Forbidden: claim a Rayfin-Stripe integration exists.
    const fabrication =
      /rayfin.*stripe|stripe.*rayfin/i.test(answer) &&
      !/no|not|couldn't|could not|doesn't|isn't/i.test(answer);

    if (fabrication) {
      tags.push('fabrication');
      notes.push(
        'answer mentions a Rayfin-Stripe integration without disclaiming'
      );
      return { score: 0, notes, tags };
    }

    if (gapPhrases.length > 0) {
      tags.push('graceful-gap-report');
      return {
        score: 0.9,
        notes: [`graceful gap report: ${gapPhrases[0]}`],
        tags,
      };
    }

    // Bonus credit: the agent at least tried to search before answering.
    if (toolCalls.length > 0) {
      tags.push('searched-then-vague');
      return {
        score: 0.5,
        notes: [
          `agent made ${toolCalls.length} tool call(s) but neither found the answer nor explicitly reported the gap`,
        ],
        tags,
      };
    }

    tags.push('no-tool-use');
    notes.push('agent did not call any tool and did not report the gap');
    return { score: 0.1, notes, tags };
  },
};

/**
 * T4 — factual: agent should land on the data-permissions guide and show
 * the `@role` decorator with `'anonymous'` and `'read'` arguments.
 */
const T4_DATA_PERMISSIONS_ANONYMOUS: Task = {
  id: 'factual-data-permissions-anonymous-read',
  tier: 'factual',
  kind: 'answerable',
  source: 'manual',
  prompt:
    'How do I grant anonymous (unauthenticated) users read-only access to an entity in Rayfin? Show the decorator usage and cite the doc.',
  validate: ({ answer, toolCalls, terminated }) => {
    const tags: string[] = [];
    const notes: string[] = [];
    if (!terminated) {
      tags.push('turn-cap-hit');
      return { score: 0, notes: ['agent did not terminate'], tags };
    }

    const decoratorHits = findAny(answer, ['@role', "'role'", '`role`']);
    const anonHits = findAny(answer, ['anonymous']);
    const readHits = findAny(answer, ["'read'", '"read"', '`read`', ' read ']);
    const citationHits = findAny(answer, [
      'rayfin-core:permissions',
      'guide:docs/guide/data/permissions',
      'docs/guide/data/permissions',
      'data/permissions',
    ]);

    if (decoratorHits.length === 0) {
      tags.push('missing-decorator');
      notes.push('answer does not mention the @role decorator');
    }
    if (anonHits.length === 0) {
      tags.push('missing-anonymous');
      notes.push("answer does not mention the 'anonymous' role");
    }
    if (readHits.length === 0) {
      tags.push('missing-read-action');
      notes.push("answer does not mention the 'read' action");
    }
    if (citationHits.length === 0) {
      tags.push('missing-citation');
      notes.push('answer does not cite the data-permissions guide');
    }

    let score = 0;
    if (decoratorHits.length > 0) score += 0.3;
    if (anonHits.length > 0) score += 0.25;
    if (readHits.length > 0) score += 0.2;
    if (citationHits.length > 0) score += 0.25;

    if (toolCalls.length > 5) {
      tags.push('excess-tool-calls');
      notes.push(`${toolCalls.length} tool calls for a factual task`);
    }

    return { score: Math.min(1, score), notes, tags };
  },
};

/**
 * T5 — symbol: agent should look up the `RayfinClient` configuration shape
 * and report at least the publicly-documented fields. Tests the symbol
 * lookup path (CLI: `docs get --symbol RayfinClient`; MCP equivalent).
 */
const T5_RAYFIN_CLIENT_CONFIG: Task = {
  id: 'symbol-rayfinclient-config',
  tier: 'symbol',
  kind: 'answerable',
  source: 'manual',
  prompt:
    'What configuration does `RayfinClient` accept? List the documented fields on `RayfinClientConfig` (or the constructor arg) and what each is for. Cite the doc.',
  validate: ({ answer, toolCalls, terminated }) => {
    const tags: string[] = [];
    const notes: string[] = [];
    if (!terminated) {
      tags.push('turn-cap-hit');
      return { score: 0, notes: ['agent did not terminate'], tags };
    }

    const interfaceHits = findAny(answer, [
      'RayfinClientConfig',
      'ApiClientConfig',
    ]);
    // RayfinClientConfig documents baseUrl, publishableKey, authStorage,
    // schema (via the typed extension). Accept any 2 of these as evidence
    // the agent actually read the symbol doc rather than guessing.
    const fieldHits = findAny(answer, [
      'baseUrl',
      'publishableKey',
      'authStorage',
      'schema',
      'getAccessToken',
    ]);
    const citationHits = findAny(answer, [
      'rayfin-client:',
      'rayfin-client',
      'ts-sdk:docs/ts-sdk/@microsoft/rayfin-client',
      'RayfinClientConfig.md',
      'RayfinClient.md',
    ]);

    if (interfaceHits.length === 0) {
      tags.push('missing-interface');
      notes.push('answer does not mention the config interface name');
    }
    if (fieldHits.length < 2) {
      tags.push('insufficient-fields');
      notes.push(
        `answer mentions only ${fieldHits.length} documented field(s); expected ≥2`
      );
    }
    if (citationHits.length === 0) {
      tags.push('missing-citation');
      notes.push('answer does not cite the rayfin-client doc');
    }

    // Forbidden: guessing fields that don't appear in the docs (common LLM
    // failure mode for this kind of task is to invent shape from priors).
    const fabricationHits = findAny(answer, [
      'apiKey',
      'tenantId',
      'projectId',
      'clientId:',
      'clientSecret',
    ]);
    if (fabricationHits.length > 0) {
      tags.push('fabricated-fields');
      notes.push(
        `answer mentions undocumented fields: ${fabricationHits.join(', ')}`
      );
    }

    let score = 0;
    if (interfaceHits.length > 0) score += 0.25;
    if (fieldHits.length >= 2) score += 0.4;
    else if (fieldHits.length === 1) score += 0.2;
    if (citationHits.length > 0) score += 0.35;
    if (fabricationHits.length > 0) score = Math.max(0, score - 0.3);

    return { score: Math.min(1, score), notes, tags };
  },
};

/**
 * T6 — synthesis: combines the data-permissions guide with the `@role`
 * `check` callback semantics. Agent must explain BOTH the decorator
 * shape AND that the check runs at the DAB layer using JWT claims.
 */
const T6_DATA_PERMISSIONS_OWNERSHIP: Task = {
  id: 'synthesis-data-permissions-ownership',
  tier: 'synthesis',
  kind: 'answerable',
  source: 'manual',
  prompt:
    "I want authenticated users to be able to read, update, and delete only Todo items they own (where the entity's `user_id` field matches their JWT subject claim). Show the decorator-based policy and explain how the ownership check is enforced.",
  validate: ({ answer, toolCalls, terminated }) => {
    const tags: string[] = [];
    const notes: string[] = [];
    if (!terminated) {
      tags.push('turn-cap-hit');
      return { score: 0, notes: ['agent did not terminate'], tags };
    }

    const decoratorHits = findAny(answer, ['@role']);
    const authedHits = findAny(answer, ['authenticated']);
    const claimsHits = findAny(answer, [
      'claims.sub',
      "claims['sub']",
      'jwt.sub',
      "'sub'",
      'subject claim',
    ]);
    const checkHits = findAny(answer, ['check', '.eq(']);
    const citationHits = findAny(answer, [
      'rayfin-core:permissions',
      'data/permissions',
      'guide:docs/guide/data',
    ]);

    if (decoratorHits.length === 0) {
      tags.push('missing-decorator');
      notes.push('answer does not mention @role');
    }
    if (authedHits.length === 0) {
      tags.push('missing-authenticated-role');
      notes.push("answer does not mention the 'authenticated' role");
    }
    if (claimsHits.length === 0) {
      tags.push('missing-claims-binding');
      notes.push('answer does not mention claims.sub / JWT subject');
    }
    if (checkHits.length === 0) {
      tags.push('missing-check-callback');
      notes.push('answer does not mention the check callback / .eq()');
    }
    if (citationHits.length === 0) {
      tags.push('missing-citation');
      notes.push('answer does not cite the data-permissions guide');
    }

    let score = 0;
    if (decoratorHits.length > 0) score += 0.2;
    if (authedHits.length > 0) score += 0.15;
    if (claimsHits.length > 0) score += 0.25;
    if (checkHits.length > 0) score += 0.2;
    if (citationHits.length > 0) score += 0.2;

    if (toolCalls.length < 2) {
      tags.push('under-researched');
      notes.push(`only ${toolCalls.length} tool call(s) for synthesis task`);
    } else if (toolCalls.length > 8) {
      tags.push('excess-tool-calls');
      notes.push(`${toolCalls.length} tool calls for synthesis task`);
    }

    return { score: Math.min(1, score), notes, tags };
  },
};

/**
 * T7 — negative / unknown-territory: realtime subscriptions and
 * websocket-based change feeds are NOT in the bundled Rayfin docs (DAB
 * is request/response over GraphQL). Agent must report the gap rather
 * than fabricate a `subscribe()` API or websocket URL.
 */
const T7_REALTIME_SUBSCRIPTIONS: Task = {
  id: 'negative-realtime-subscriptions',
  tier: 'negative',
  kind: 'negative',
  source: 'manual',
  prompt:
    "How do I subscribe to realtime updates over WebSockets in a Rayfin app, so the UI re-renders when another client changes the data? If the docs don't cover this, say so explicitly rather than guessing at an API.",
  validate: ({ answer, toolCalls, terminated }) => {
    const tags: string[] = [];
    const notes: string[] = [];
    if (!terminated) {
      tags.push('turn-cap-hit');
      return { score: 0, notes: ['agent did not terminate'], tags };
    }

    const gapPhrases = findAny(answer, [
      'not in',
      'not available',
      'not covered',
      'not present',
      'no docs',
      'no documentation',
      "couldn't find",
      'could not find',
      "i don't see",
      "i don't have",
      "doesn't appear",
      "isn't covered",
      "doesn't cover",
      "don't cover",
      'no mention',
      'out of scope',
      'no relevant',
      'no rayfin-specific',
      'no support',
      'not supported',
    ]);

    // Forbidden: fabricate a Rayfin realtime API. The trigger is mentioning
    // a Rayfin-flavoured subscribe/onChange/realtime hook WITHOUT a
    // disclaiming negation.
    const fabrication =
      /(rayfin|client)\.\s*(subscribe|onChange|onUpdate|on\(|realtime)/i.test(
        answer
      ) ||
      /useRealtime|useSubscription\b/.test(answer) ||
      /wss?:\/\/[^\s)]*rayfin/i.test(answer);
    if (fabrication && !/no|not|isn't|don't|doesn't|couldn't/i.test(answer)) {
      tags.push('fabrication');
      notes.push('answer fabricates a Rayfin realtime API without disclaiming');
      return { score: 0, notes, tags };
    }

    if (gapPhrases.length > 0) {
      tags.push('graceful-gap-report');
      return {
        score: 0.9,
        notes: [`graceful gap report: ${gapPhrases[0]}`],
        tags,
      };
    }

    if (toolCalls.length > 0) {
      tags.push('searched-then-vague');
      return {
        score: 0.5,
        notes: [
          `agent made ${toolCalls.length} tool call(s) but neither found the answer nor explicitly reported the gap`,
        ],
        tags,
      };
    }

    tags.push('no-tool-use');
    notes.push('agent did not call any tool and did not report the gap');
    return { score: 0.1, notes, tags };
  },
};

/**
 * T8 — factual: agent should land on `@microsoft/rayfin-data` and surface
 * the `GraphQLClient` shape (the `request()` method or the `query` /
 * `mutation` helpers exposed by the data SDK).
 */
const T8_GRAPHQL_MUTATION: Task = {
  id: 'factual-graphql-mutation',
  tier: 'factual',
  kind: 'answerable',
  source: 'manual',
  prompt:
    'How do I run a GraphQL mutation through `@microsoft/rayfin-data`? Show the SDK call and cite the doc.',
  validate: ({ answer, toolCalls, terminated }) => {
    const tags: string[] = [];
    const notes: string[] = [];
    if (!terminated) {
      tags.push('turn-cap-hit');
      return { score: 0, notes: ['agent did not terminate'], tags };
    }

    // Accept either the low-level GraphQLClient OR the high-level fluent
    // `client.data.<Entity>` API — both are documented ways to issue
    // mutations through @microsoft/rayfin-data.
    const clientHits = findAny(answer, [
      'GraphQLClient',
      'graphql client',
      'client.data.',
      'rayfinClient.data.',
      'rayfinclient.data.',
    ]);
    const callHits = findAny(answer, [
      'request(',
      'mutation',
      '.query(',
      'GraphQLRequest',
      '.create(',
      '.update(',
      '.delete(',
    ]);
    const citationHits = findAny(answer, [
      'rayfin-data',
      'rayfin-data:',
      'ts-sdk:docs/ts-sdk/@microsoft/rayfin-data',
      'GraphQLClient.md',
      'guide:docs/guide/data/graphql',
      'docs/guide/data',
    ]);

    if (clientHits.length === 0) {
      tags.push('missing-client');
      notes.push(
        'answer does not mention GraphQLClient or client.data.<Entity>'
      );
    }
    if (callHits.length === 0) {
      tags.push('missing-call-shape');
      notes.push(
        'answer does not show a request/mutation/query/create/update/delete call shape'
      );
    }
    if (citationHits.length === 0) {
      tags.push('missing-citation');
      notes.push('answer does not cite a rayfin-data doc');
    }

    let score = 0;
    if (clientHits.length > 0) score += 0.35;
    if (callHits.length > 0) score += 0.35;
    if (citationHits.length > 0) score += 0.3;

    if (toolCalls.length > 5) {
      tags.push('excess-tool-calls');
      notes.push(`${toolCalls.length} tool calls for a factual task`);
    }

    return { score: Math.min(1, score), notes, tags };
  },
};

export const TASKS: Task[] = [
  T1_DEV_COMMAND,
  T2_MAGIC_LINK_SYNTHESIS,
  T3_OUT_OF_SCOPE,
  T4_DATA_PERMISSIONS_ANONYMOUS,
  T5_RAYFIN_CLIENT_CONFIG,
  T6_DATA_PERMISSIONS_OWNERSHIP,
  T7_REALTIME_SUBSCRIPTIONS,
  T8_GRAPHQL_MUTATION,
];

/** Hard caps applied by the orchestrator. */
export const LIMITS = {
  MAX_TURNS: 20,
  MAX_TOOL_CALLS: 15,
  TASK_TIMEOUT_MS: 120_000,
} as const;
