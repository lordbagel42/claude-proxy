# Upstream contract

How the proxy talks to `api.anthropic.com` with a Claude subscription OAuth
token. These details were taken from Claude Code 2.1.296 and verified against
the live API on 2026-10-10. Re-verify them when requests start failing.

## Request shaping

| Item | Value | Notes |
| --- | --- | --- |
| Auth | `Authorization: Bearer <CLAUDE_CODE_OAUTH_TOKEN>` | Token from `claude setup-token` (`sk-ant-oat01-…`, valid for one year, scope `user:inference`). |
| `anthropic-beta` | `oauth-2025-04-20,claude-code-20250219` + client betas, except `fast-mode-*` | Fast-mode betas are stripped; all other client betas are preserved. |
| `anthropic-version` | Client value, default `2023-06-01` | |
| `User-Agent` | `claude-cli/<CLAUDE_CODE_VERSION> (external, cli)` | Plus `x-app: cli`, mirroring Claude Code. |
| System prompt | First block must be exactly `You are Claude Code, Anthropic's official CLI for Claude.` | See below. |
| Model | Strip one leading `anthropic/` from string model IDs | Applies to messages and token counts; bare IDs and other prefixes are unchanged. |
| Speed | Remove `speed: "fast"` | Silently uses standard speed without changing the model, thinking, or effort. |

Only `accept` and `idempotency-key` are forwarded from the client besides the
headers above. Upstream responses pass through unchanged (including the
`anthropic-ratelimit-unified-*` subscription usage headers and SSE streams),
except `set-cookie`, `anthropic-organization-id`, and `anthropic-workspace-id`.

Fast mode is intentionally disabled on both message and token-count requests.
The [upstream fast-mode contract](https://platform.claude.com/docs/en/build-with-claude/fast-mode)
(checked 2026-10-11) selects fast inference with `speed: "fast"` and the
`fast-mode-2026-02-01` beta; omitting that speed requests standard inference.
The proxy removes the fast speed and every `fast-mode-*` beta before the first
upstream call, rather than attempting fast inference and retrying. Explicit
`speed: "standard"` and unrelated request options are left unchanged.

## The identity block

Without the identity block, Haiku models work, but other models such as
`claude-sonnet-5-5` fail with HTTP 429:

```json
{"type":"error","error":{"type":"rate_limit_error","message":"Error"}}
```

This is not a real rate limit. The identity must be its own text block at
index 0: prefixing it to a string `system` prompt still fails. The proxy
converts string prompts to blocks and prepends the identity unless block 0
already matches, which keeps `cache_control` breakpoints intact.

## Endpoints

| Proxy route | Upstream | Notes |
| --- | --- | --- |
| `POST /v1/messages` | same | Body rewritten (identity and fast-mode removal), query string preserved (`?beta=true`). |
| `POST /v1/messages/count_tokens` | same | Identity injected so counts match what is billed; fast mode removed. |
| `GET /v1/models`, `GET /v1/models/:id` | same | Passthrough. |

Not proxied: `/api/oauth/usage` requires the `user:profile` scope, which
`setup-token` tokens lack. Usage is visible in the rate-limit response headers
instead.

## OAuth constants (for reference)

Claude Code refreshes interactive-login tokens with
`POST https://platform.claude.com/v1/oauth/token`, JSON body
`{grant_type: "refresh_token", refresh_token, client_id}`, client ID
`9d1c250a-e61b-44d9-88ed-5944d1962f5e`. Refresh tokens rotate on use, so a
refresh token shared with a local Claude Code install would break one of them.
The proxy therefore uses long-lived `setup-token` tokens and does not refresh.
