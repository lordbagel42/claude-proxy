export interface Env {
  /** Subscription OAuth token from `claude setup-token` (secret). */
  CLAUDE_CODE_OAUTH_TOKEN?: string;
  /** Comma-separated keys clients must present (secret). */
  PROXY_API_KEYS?: string;
  /** Anthropic API origin; overridable for local testing. */
  UPSTREAM_BASE_URL?: string;
  /** Claude Code version advertised in the upstream User-Agent. */
  CLAUDE_CODE_VERSION?: string;
}
