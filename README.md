# claude-proxy

A Cloudflare Worker that exposes an Anthropic Messages API–compatible endpoint
backed by your Claude subscription (Pro/Max) instead of API credits. Point any
Anthropic SDK or tool at it with a proxy key; the Worker swaps in your
subscription OAuth token and shapes requests the way Claude Code does.

```diagram
┌────────────┐  x-api-key: <proxy key>   ┌──────────────┐  Bearer <OAuth token>   ┌───────────────────┐
│ SDK / tool │ ────────────────────────▶ │ claude-proxy │ ──────────────────────▶ │ api.anthropic.com │
└────────────┘ ◀──── SSE / JSON ──────── └──────────────┘ ◀──── SSE / JSON ────── └───────────────────┘
```

Supported routes: `POST /v1/messages` (streaming and non-streaming),
`POST /v1/messages/count_tokens`, `GET /v1/models`, `GET /v1/models/:id`, and
an unauthenticated `GET /health`. See [docs/upstream.md](docs/upstream.md) for
exactly what the proxy changes.

> Using a subscription through a proxy is subject to Anthropic's terms for
> your plan. Keep the proxy private: anyone with a proxy key spends your
> subscription's usage limits.

## Setup

Requires Node.js 24+ and pnpm.

```sh
pnpm install
claude setup-token          # prints a one-year sk-ant-oat01-… token
```

### Local development

```sh
cp .dev.vars.example .dev.vars   # fill in the token and a proxy key
pnpm dev                          # http://localhost:8787
```

### Deploy

```sh
pnpm exec wrangler login
pnpm exec wrangler secret put CLAUDE_CODE_OAUTH_TOKEN
pnpm exec wrangler secret put PROXY_API_KEYS   # e.g. "laptop-key,ci-key"
pnpm run deploy
```

The Worker is served at `https://claude.raygen.dev` through a Cloudflare
custom domain (`routes` in `wrangler.jsonc`), which requires the `raygen.dev`
zone to be in the same Cloudflare account. Wrangler creates the DNS record and
certificate on deploy. To use a different hostname, change that route.

Generate proxy keys with `openssl rand -hex 32`. Multiple comma-separated keys
let you revoke one client without rotating the others. The proxy refuses all
API requests when `PROXY_API_KEYS` is unset.

| Name | Kind | Purpose |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | secret | Subscription token from `claude setup-token`. |
| `PROXY_API_KEYS` | secret | Comma-separated keys clients must present. |
| `UPSTREAM_BASE_URL` | var | Defaults to `https://api.anthropic.com`. |
| `CLAUDE_CODE_VERSION` | var | Version in the upstream `User-Agent`. |

## Usage

Clients send the proxy key as `x-api-key` or `Authorization: Bearer`.

```sh
curl https://claude.raygen.dev/v1/messages \
  -H "x-api-key: $PROXY_KEY" -H "content-type: application/json" \
  -d '{"model":"claude-sonnet-5-5","max_tokens":1024,
       "messages":[{"role":"user","content":"Hello"}]}'
```

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "https://claude.raygen.dev",
  apiKey: process.env.PROXY_KEY,
});
```

Every request gets the Claude Code identity as its first system block (the
subscription requires it for non-Haiku models); your own system prompt follows
it unchanged. Subscription usage is reported in the
`anthropic-ratelimit-unified-*` response headers.

Fast mode is disabled: requests with `speed: "fast"` silently run at standard
speed with the same model and reasoning settings. Fast-mode beta flags are
also removed before forwarding.

## Development

```sh
pnpm check   # biome lint/format check, tsc, vitest
pnpm format
```

See [AGENTS.md](AGENTS.md) for the workflow: trunk-based development on
`main` with small Conventional Commits.

### Continuous deployment

`.github/workflows/ci.yml` runs `pnpm check` on every push to `main`. To also
deploy from CI, set the repository variable `CLOUDFLARE_DEPLOY=true` and the
secrets `CLOUDFLARE_API_TOKEN` (Workers edit permission) and
`CLOUDFLARE_ACCOUNT_ID`. Worker secrets stay managed with `wrangler secret`.
