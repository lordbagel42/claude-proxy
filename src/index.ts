import { Hono } from "hono";
import { clientKey, isAuthorized, parseProxyKeys } from "./auth";
import type { Env } from "./env";
import { errorResponse } from "./errors";
import {
  proxiedResponse,
  upstreamHeaders,
  upstreamUrl,
  withIdentity,
} from "./upstream";

type AppEnv = { Bindings: Env; Variables: { token: string } };

const app = new Hono<AppEnv>();

app.get("/", (c) => c.json({ status: "ok" }));
app.get("/health", (c) => c.json({ status: "ok" }));

app.use("/v1/*", async (c, next) => {
  const keys = parseProxyKeys(c.env.PROXY_API_KEYS);
  if (keys.length === 0) {
    return errorResponse(500, "api_error", "Proxy has no PROXY_API_KEYS.");
  }
  const presented = clientKey(c.req.raw.headers);
  if (!presented || !(await isAuthorized(presented, keys))) {
    return errorResponse(401, "authentication_error", "Invalid proxy key.");
  }
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

/** Sends a request to a fixed upstream path, keeping the client's query. */
async function forward(
  request: Request,
  env: Env,
  token: string,
  path: string,
  body?: string,
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

for (const path of ["/v1/messages", "/v1/messages/count_tokens"]) {
  app.post(path, async (c) => {
    const started = Date.now();
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(await c.req.text());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new TypeError("body must be a JSON object");
      }
      body = parsed as Record<string, unknown>;
      if (typeof body.model === "string") {
        body.model = body.model.replace(/^anthropic\//, "");
      }
      body.system = withIdentity(body.system);
      // Omitting fast mode selects the upstream's standard speed.
      if (body.speed === "fast") delete body.speed;
    } catch (error) {
      const message = error instanceof Error ? error.message : `${error}`;
      return errorResponse(400, "invalid_request_error", message);
    }

    const response = await forward(
      c.req.raw,
      c.env,
      c.var.token,
      path,
      JSON.stringify(body),
    );
    console.log(
      JSON.stringify({
        event: "request",
        path,
        model: typeof body.model === "string" ? body.model : undefined,
        stream: body.stream === true,
        status: response.status,
        ms: Date.now() - started,
      }),
    );
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
    `/v1/models/${encodeURIComponent(c.req.param("id"))}`,
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
