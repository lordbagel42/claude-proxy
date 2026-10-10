# Claude proxy project guidance

This repository is a Cloudflare Worker that exposes an Anthropic Messages
API–compatible endpoint backed by a Claude subscription OAuth token. Read
`README.md` for setup and `docs/upstream.md` for the upstream contract the
proxy depends on.

## Session startup

- Always pull the latest code from the current branch's configured remote
  upstream at the start of every session, before beginning work. Use
  `git pull --ff-only` to avoid implicit merge commits or rebases.
- Check Git status first and preserve all local changes and unpushed commits.
  If the pull is blocked by local changes, divergent history, a missing upstream,
  or an authentication failure, report the blocker rather than resetting,
  discarding, or automatically stashing work.

## Trunk-based development and shipping

- Work directly on `main`. Do not create feature branches or pull requests;
  this repository uses trunk-based development, not a branch-and-PR workflow.
- Ship the smallest working, verified increment to remote `main` as soon as it
  is ready, even when the larger feature is unfinished. Keep `main` usable;
  do not wait to batch independently shippable changes into a complete feature.
- Use small, atomic Conventional Commits. Run `pnpm check` (formatter/linter,
  typechecker, and tests) before committing code, plus relevant focused checks.
- Larger or high-impact changes require an independent review (Oracle or a
  review subagent) before shipping. Address material findings before pushing;
  small, routine changes do not require a review.
- Agents have standing permission to commit and push ready changes directly to
  remote `main` without asking for approval each time. This permission does not
  authorize force-pushing, discarding others' work, or unrelated external actions.
- Fetch the latest remote `main` before pushing and integrate concurrent changes
  safely, rerunning affected checks. Use normal, non-force pushes only.
- Preserve other sessions' work. If an existing shared checkout is on another
  branch, do not switch it out from under them or ship their unreviewed changes;
  use a separate checkout on `main` instead.
- Do not impose push holds on this or other agents for measurements, settings
  changes, or coordination. Rebase over concurrent work.

## Tests and verification

- Keep unit tests few and focused. Prioritize thorough manual testing of real
  workflows, edge cases, and failure paths.
- Manually verify behavior changes against `pnpm dev` (local workerd via
  Wrangler) with a real client, such as `curl` or the Anthropic SDK, covering
  both streaming and non-streaming requests. Prefer `claude-haiku-*` models and
  small `max_tokens` so verification spends little of the subscription quota.
- Distinguish what was verified against the real upstream from what was only
  covered by mocked unit tests when reporting results.

## Upstream contract

- The proxy must keep working the way Claude Code itself talks to the API.
  When changing request shaping, re-check `docs/upstream.md` and update it in
  the same change if the contract moved.
- Non-Haiku models reject subscription OAuth requests unless the first system
  block is exactly the Claude Code identity string. The failure is disguised as
  `rate_limit_error` with the message `Error`; do not "fix" it with retries.
- Forward only allowlisted request headers upstream. Never forward the client's
  proxy key, cookies, or Cloudflare/forwarding headers.

## Secrets and privacy

- Never print, log, or commit credentials: `CLAUDE_CODE_OAUTH_TOKEN`,
  `PROXY_API_KEYS`, Cloudflare API tokens, or `.dev.vars` contents.
- Never log prompt or completion bodies. Request logs are limited to method,
  path, model, stream flag, status, and duration.
- Keep the proxy fail-closed: with no `PROXY_API_KEYS` configured it must
  refuse all API requests rather than become an open relay for the
  subscription.

## Deployment safety

- Raygen grants standing authorization to deploy reviewed code from `main` to
  the existing `claude-proxy` Worker (served at `claude.raygen.dev`) and to
  update its existing secrets and variables when a requested change requires
  it. Do not ask again merely because completing the requested feature
  requires these actions.
- This permission is scoped to the requested outcome. It does not authorize
  creating unrelated Cloudflare resources, changing routes or custom domains,
  deleting Workers or data, or rotating the subscription token without being
  asked.
- Deploy with `pnpm run deploy` (Wrangler) or the CI deploy job, not ad hoc
  dashboard edits. Repository publication is not evidence of deployment: verify
  the deployed version (`wrangler deployments list`) and a live
  `https://claude.raygen.dev/health` check.
- Do not change configuration or secrets concurrently with a deployment.
