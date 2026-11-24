import { Hono } from "hono";
import {
  Meter,
  meterStream,
  requestFacts,
  responseFacts,
  statsStore,
  writeRecord,
} from "./analytics";
import { clientKey, configuredKeys, matchKey } from "./auth";
import { type PreparedBody, prepareBody } from "./body";
import type { Env } from "./env";
import { errorResponse } from "./errors";
import { STATS_PAGE } from "./page";
import {
  normalizeModel,
  proxiedResponse,
  upstreamHeaders,
  upstreamUrl,
} from "./upstream";

type AppEnv = { Bindings: Env; Variables: { token: string; keyName: string } };

const app = new Hono<AppEnv>();

app.get("/health", (c) => c.json({ status: "ok" }));

// Public usage dashboard (metadata only; see src/analytics.ts).
app.get("/", (c) => c.html(STATS_PAGE));
app.get("/stats", (c) => c.html(STATS_PAGE));
app.get("/stats.json", async (c) => {
  if (!c.env.STATS) {
    return errorResponse(503, "api_error", "Stats storage is not configured.");
  }
  const stats = await statsStore(c.env.STATS).stats(c.req.query("range"));
  return c.json(stats, 200, { "cache-control": "public, max-age=30" });
});

app.use("/v1/*", async (c, next) => {
  const keys = configuredKeys(c.env);
  if (keys.length === 0) {
    return errorResponse(500, "api_error", "Proxy has no proxy keys.");
  }
  const presented = clientKey(c.req.raw.headers);
  const keyName = presented ? await matchKey(presented, keys) : undefined;
  if (!keyName) {
    return errorResponse(401, "authentication_error", "Invalid proxy key.");
  }
  c.set("keyName", keyName);
  const token = c.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (!token) {
    return errorResponse(
      500,
      "api_error",
      "Proxy has no CLAUDE_CODE_OAUTH_TOKEN.",
    );
  }
  c.set("token", token);
  await next();
});

/** Keeps the Worker alive for `promise`; tests have no execution context. */
function waitUntil(
  c: { executionCtx: { waitUntil(promise: Promise<unknown>): void } },
  promise: Promise<void>,
) {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    // No ExecutionContext outside workerd.
  }
}

/** Sends a request to a fixed upstream path, keeping the client's query. */
async function forward(
  request: Request,
  env: Env,
  token: string,
  path: string,
  body?: Uint8Array,
): Promise<Response> {
  try {
    const upstream = await fetch(
      upstreamUrl(env, path, new URL(request.url).search),
      {
        method: request.method,
        headers: upstreamHeaders(request.headers, token, env),
        body,
      },
    );
    return proxiedResponse(upstream);
  } catch (error) {
    console.error(
      JSON.stringify({ event: "upstream_failed", error: `${error}` }),
    );
    return errorResponse(502, "api_error", "Upstream request failed.");
  }
}

/**
 * The upstream's Messages API request limit. Larger bodies would fail there
 * anyway, and buffering them risks the isolate's 128 MB memory limit.
 */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

for (const path of ["/v1/messages", "/v1/messages/count_tokens"]) {
  app.post(path, async (c) => {
    const started = Date.now();
    const tooLarge = () =>
      errorResponse(
        413,
        "request_too_large",
        `Request exceeds the maximum allowed number of bytes (${MAX_BODY_BYTES}).`,
      );
    if (Number(c.req.header("content-length") ?? 0) > MAX_BODY_BYTES) {
      return tooLarge();
    }
    let prepared: PreparedBody;
    try {
      // Raw bytes, not c.req: Hono would cache a second copy of the body.
      const bytes = new Uint8Array(await c.req.raw.arrayBuffer());
      if (bytes.length > MAX_BODY_BYTES) return tooLarge();
      prepared = prepareBody(bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : `${error}`;
      return errorResponse(400, "invalid_request_error", message);
    }

    const { payload, fields } = prepared;
    const facts = requestFacts(
      c.var.keyName,
      path,
      fields,
      prepared,
      c.req.raw.headers,
      payload.length,
    );
    const response = await forward(
      c.req.raw,
      c.env,
      c.var.token,
      path,
      payload,
    );
    const meter = new Meter();
    const done = () =>
      writeRecord(c.env, {
        ...facts,
        ...responseFacts(meter, response.status, response.headers, started),
      });

    const type = response.headers.get("content-type") ?? "";
    if (response.body && type.includes("text/event-stream")) {
      let resolve = () => {};
      const finished = new Promise<void>((r) => {
        resolve = r;
      });
      waitUntil(c, finished);
      const stream = meterStream(response.body, meter, () => {
        done().finally(resolve);
      });
      return new Response(stream, response);
    }
    try {
      meter.message(await response.clone().json());
    } catch {
      // Not JSON; record status and timing only.
    }
    waitUntil(c, done());
    return response;
  });
}

app.get("/v1/models", (c) =>
  forward(c.req.raw, c.env, c.var.token, "/v1/models"),
);
app.get("/v1/models/:id", (c) =>
  forward(
    c.req.raw,
    c.env,
    c.var.token,
    `/v1/models/${encodeURIComponent(normalizeModel(c.req.param("id")))}`,
  ),
);

app.notFound(() =>
  errorResponse(404, "not_found_error", "Not supported by this proxy."),
);

app.onError((error) => {
  console.error(JSON.stringify({ event: "error", error: `${error}` }));
  return errorResponse(500, "api_error", "Internal proxy error.");
});

export default app;
