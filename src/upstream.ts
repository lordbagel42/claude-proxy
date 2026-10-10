import type { Env } from "./env";

/** Required first system block for subscription OAuth on non-Haiku models. */
export const CLAUDE_CODE_IDENTITY =
  "You are Claude Code, Anthropic's official CLI for Claude.";

export const OAUTH_BETAS = ["oauth-2025-04-20", "claude-code-20250219"];

const DEFAULT_UPSTREAM = "https://api.anthropic.com";
const DEFAULT_VERSION = "2023-06-01";
const DEFAULT_CLAUDE_CODE_VERSION = "2.1.296";

/** Client request headers that are safe and meaningful to forward. */
const FORWARDED_REQUEST_HEADERS = ["accept", "idempotency-key"];

/** Upstream response headers that identify the subscription account. */
const DROPPED_RESPONSE_HEADERS = [
  "set-cookie",
  "anthropic-organization-id",
  "anthropic-workspace-id",
];

export function mergeBetas(clientBetas: string | null): string {
  const betas = new Set(OAUTH_BETAS);
  for (const beta of (clientBetas ?? "").split(",")) {
    const trimmed = beta.trim();
    if (trimmed) betas.add(trimmed);
  }
  return [...betas].join(",");
}

export function upstreamHeaders(
  client: Headers,
  token: string,
  env: Env,
): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = client.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("authorization", `Bearer ${token}`);
  headers.set(
    "anthropic-version",
    client.get("anthropic-version") ?? DEFAULT_VERSION,
  );
  headers.set("anthropic-beta", mergeBetas(client.get("anthropic-beta")));
  headers.set("content-type", "application/json");
  headers.set(
    "user-agent",
    `claude-cli/${env.CLAUDE_CODE_VERSION || DEFAULT_CLAUDE_CODE_VERSION} (external, cli)`,
  );
  headers.set("x-app", "cli");
  return headers;
}

export function upstreamUrl(env: Env, path: string, search: string): string {
  const base = (env.UPSTREAM_BASE_URL || DEFAULT_UPSTREAM).replace(/\/+$/, "");
  return `${base}${path}${search}`;
}

type SystemBlock = { type: string; text?: string; [key: string]: unknown };

/**
 * Returns `system` with the Claude Code identity as its own first text block,
 * converting a string prompt into blocks. Merging the identity into the
 * client's text does not satisfy the upstream check.
 */
export function withIdentity(system: unknown): SystemBlock[] {
  const identity: SystemBlock = { type: "text", text: CLAUDE_CODE_IDENTITY };
  if (system === undefined || system === null || system === "") {
    return [identity];
  }
  if (typeof system === "string") {
    return [identity, { type: "text", text: system }];
  }
  if (Array.isArray(system)) {
    const first = system[0] as SystemBlock | undefined;
    if (first?.type === "text" && first.text === CLAUDE_CODE_IDENTITY) {
      return system as SystemBlock[];
    }
    return [identity, ...(system as SystemBlock[])];
  }
  throw new TypeError("system must be a string or an array of content blocks");
}

/** Copies an upstream response, dropping headers that identify the account. */
export function proxiedResponse(upstream: Response): Response {
  const response = new Response(upstream.body, upstream);
  for (const name of DROPPED_RESPONSE_HEADERS) response.headers.delete(name);
  return response;
}
