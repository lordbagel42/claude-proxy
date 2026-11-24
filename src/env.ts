import type { StatsStore } from "./store";

export interface Env {
  /** Subscription OAuth token from `claude setup-token` (secret). */
  CLAUDE_CODE_OAUTH_TOKEN?: string;
  /** Legacy comma-separated client keys (secret). Prefer PROXY_KEY_<NAME>. */
  PROXY_API_KEYS?: string;
  /** One secret per client, e.g. PROXY_KEY_LAPTOP; the suffix names it. */
  [namedKey: `PROXY_KEY_${string}`]: string | undefined;
  /** Workers Analytics Engine dataset for per-request usage. */
  ANALYTICS?: AnalyticsEngineDataset;
  /** SQLite Durable Object holding one metadata row per request. */
  STATS?: DurableObjectNamespace<StatsStore>;
  /** Anthropic API origin; overridable for local testing. */
  UPSTREAM_BASE_URL?: string;
  /** Claude Code version advertised in the upstream User-Agent. */
  CLAUDE_CODE_VERSION?: string;
}
