/**
 * SQL for the stats store: one metadata row per proxied request (never
 * prompt or completion text) and the aggregates behind the public page.
 * The page is public, so results never break usage down by proxy key.
 */

export const SCHEMA = `CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  key TEXT NOT NULL,
  path TEXT NOT NULL,
  model TEXT,
  client TEXT,
  stream INTEGER NOT NULL,
  status INTEGER NOT NULL,
  error_type TEXT,
  stop_reason TEXT,
  ms INTEGER NOT NULL,
  ttft_ms INTEGER,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  web_searches INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL,  -- pay-as-you-go API price equivalent; NULL if unknown
  max_tokens INTEGER,
  thinking TEXT,
  thinking_budget INTEGER,
  effort TEXT,
  tools_offered INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  tool_names TEXT NOT NULL DEFAULT '[]',
  messages INTEGER NOT NULL DEFAULT 0,
  request_bytes INTEGER NOT NULL DEFAULT 0,
  rl_status TEXT,
  rl_overage TEXT,
  rl_5h REAL,
  rl_7d REAL,
  rl_5h_reset INTEGER,
  rl_7d_reset INTEGER
);
CREATE INDEX IF NOT EXISTS requests_ts ON requests (ts);`;

/** Column name -> value for one `requests` row. */
export type StatsRow = Record<string, string | number | null>;

export function insertSql(row: StatsRow): [string, (string | number | null)[]] {
  const columns = Object.keys(row);
  for (const column of columns) {
    if (!/^[a-z0-9_]+$/.test(column)) throw new Error(`bad column ${column}`);
  }
  return [
    `INSERT INTO requests (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    Object.values(row),
  ];
}

/** Rows older than this are pruned; a bit beyond the longest range. */
export const RETENTION_MS = 400 * 86_400_000;

const RANGES: Record<string, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

export function rangeDays(range: string | undefined): [string, number] {
  const key = range && Object.hasOwn(RANGES, range) ? range : "30d";
  return [key, RANGES[key] ?? 30];
}

const TOTALS = `COUNT(*) AS requests,
  SUM(status >= 400 OR error_type IS NOT NULL) AS errors,
  SUM(input_tokens) AS input_tokens,
  SUM(output_tokens) AS output_tokens,
  SUM(cache_read) AS cache_read,
  SUM(cache_write) AS cache_write,
  SUM(tool_calls) AS tool_calls,
  SUM(web_searches) AS web_searches,
  SUM(cost_usd) AS cost_usd,
  SUM(cost_usd IS NULL AND (input_tokens + output_tokens) > 0) AS unpriced,
  ROUND(AVG(ms)) AS avg_ms,
  ROUND(AVG(ttft_ms)) AS avg_ttft_ms`;

function breakdown(column: string, limit = 25): string {
  return `SELECT COALESCE(${column}, '(none)') AS name, ${TOTALS}
    FROM requests WHERE ts >= ? GROUP BY name
    ORDER BY requests DESC LIMIT ${limit}`;
}

/** Queries keyed by result name; each takes `since` for every `?`. */
function queries(bucketMs: number): Record<string, string> {
  return {
    totals: `SELECT ${TOTALS}, SUM(messages) AS messages,
      SUM(request_bytes) AS request_bytes, MAX(ms) AS max_ms
      FROM requests WHERE ts >= ?`,
    series: `SELECT (ts / ${bucketMs}) * ${bucketMs} AS bucket, ${TOTALS}
      FROM requests WHERE ts >= ? GROUP BY bucket ORDER BY bucket`,
    models: breakdown("model"),
    clients: breakdown("client"),
    stopReasons: breakdown("stop_reason"),
    thinking: breakdown("thinking"),
    effort: breakdown("effort"),
    errorTypes: `SELECT COALESCE(error_type, 'HTTP ' || status) AS name,
      COUNT(*) AS requests FROM requests
      WHERE ts >= ? AND (status >= 400 OR error_type IS NOT NULL)
      GROUP BY name ORDER BY requests DESC LIMIT 25`,
    tools: `SELECT j.value AS name, COUNT(*) AS calls,
      COUNT(DISTINCT r.id) AS requests
      FROM requests r, json_each(r.tool_names) j
      WHERE r.ts >= ? GROUP BY name ORDER BY calls DESC LIMIT 50`,
    rateLimit: `SELECT ts, rl_status, rl_overage, rl_5h, rl_7d, rl_5h_reset,
      rl_7d_reset FROM requests WHERE rl_5h IS NOT NULL OR rl_7d IS NOT NULL
      ORDER BY ts DESC LIMIT 1`,
    recent: `SELECT ts, path, model, client, stream, status, error_type,
      stop_reason, ms, ttft_ms, input_tokens, output_tokens, cache_read,
      cache_write, cost_usd, tool_calls, tool_names, thinking, effort,
      max_tokens
      FROM requests ORDER BY ts DESC LIMIT 50`,
  };
}

type Exec = (sql: string, ...bindings: unknown[]) => Record<string, unknown>[];

export function collectStats(exec: Exec, range: string | undefined) {
  const [name, days] = rangeDays(range);
  const now = Date.now();
  const since = now - days * 86_400_000;
  // Hourly buckets for a day, daily otherwise.
  const bucketMs = days <= 1 ? 3_600_000 : 86_400_000;
  const out: Record<string, unknown> = {
    range: name,
    days,
    since,
    now,
    bucketMs,
  };
  for (const [key, sql] of Object.entries(queries(bucketMs))) {
    const params = sql.includes("?") ? [since] : [];
    const rows = exec(sql, ...params);
    out[key] =
      key === "totals" || key === "rateLimit" ? (rows[0] ?? null) : rows;
  }
  return out;
}
