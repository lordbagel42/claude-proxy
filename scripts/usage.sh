#!/usr/bin/env bash
# Per-key usage from Workers Analytics Engine.
#   scripts/usage.sh [days=7]        summary by key and model
#   scripts/usage.sh --sql "SELECT …" run any query against claude_proxy_requests
# Needs CLOUDFLARE_ACCOUNT_ID and a token with Account Analytics: Read in
# CLOUDFLARE_API_TOKEN (falls back to `wrangler auth token`).
set -euo pipefail

if [[ "${1:-}" == "--sql" ]]; then
  sql="${2:?usage: scripts/usage.sh --sql \"SELECT …\"}"
else
  days="${1:-7}"
  [[ "$days" =~ ^[0-9]+$ ]] || { echo "days must be a number" >&2; exit 1; }
  sql="SELECT blob1 AS key, blob3 AS model,
    SUM(_sample_interval) AS requests,
    SUM(_sample_interval * IF(double1 >= 400, 1, 0)) AS errors,
    SUM(_sample_interval * double3) AS input_tokens,
    SUM(_sample_interval * double4) AS output_tokens,
    SUM(_sample_interval * double5) AS cache_read,
    SUM(_sample_interval * double6) AS cache_write,
    ROUND(SUM(_sample_interval * double2) / SUM(_sample_interval)) AS avg_ms
  FROM claude_proxy_requests
  WHERE timestamp > NOW() - INTERVAL '$days' DAY AND blob2 = '/v1/messages'
  GROUP BY key, model ORDER BY requests DESC
  FORMAT JSONEachRow"
fi

account="${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"
token="${CLOUDFLARE_API_TOKEN:-}"
if [[ -z "$token" ]]; then
  token="$(wrangler auth token 2>/dev/null | tail -1)" || true
fi
[[ -n "$token" ]] || { echo "set CLOUDFLARE_API_TOKEN (Account Analytics: Read)" >&2; exit 1; }
# Header from a file descriptor keeps the token out of the process list.
curl -sS --fail-with-body \
  "https://api.cloudflare.com/client/v4/accounts/$account/analytics_engine/sql" \
  -H @<(printf 'Authorization: Bearer %s\n' "$token") --data-binary "$sql"
echo
