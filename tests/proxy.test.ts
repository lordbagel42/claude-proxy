import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import app from "../src/index";
import { CLAUDE_CODE_IDENTITY, withIdentity } from "../src/upstream";

const env: Env = {
  CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-test",
  PROXY_API_KEYS: "key-one, key-two",
  UPSTREAM_BASE_URL: "https://upstream.test",
};

function stubUpstream(response = Response.json({ ok: true })) {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
    response.clone(),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function messages(body: unknown, headers: Record<string, string> = {}) {
  return app.request(
    "/v1/messages?beta=true",
    {
      method: "POST",
      headers: { "x-api-key": "key-two", ...headers },
      body: JSON.stringify(body),
    },
    env,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("withIdentity", () => {
  it("puts the identity in its own first block", () => {
    expect(withIdentity(undefined)).toEqual([
      { type: "text", text: CLAUDE_CODE_IDENTITY },
    ]);
    expect(withIdentity("Be terse.")).toEqual([
      { type: "text", text: CLAUDE_CODE_IDENTITY },
      { type: "text", text: "Be terse." },
    ]);
    const existing = [
      { type: "text", text: CLAUDE_CODE_IDENTITY },
      { type: "text", text: "x", cache_control: { type: "ephemeral" } },
    ];
    expect(withIdentity(existing)).toBe(existing);
  });
});

describe("proxy", () => {
  it("rejects missing and wrong keys without calling upstream", async () => {
    const fetchMock = stubUpstream();
    for (const headers of [{}, { "x-api-key": "nope" }] as HeadersInit[]) {
      const res = await app.request(
        "/v1/models",
        { headers },
        { ...env, PROXY_API_KEYS: "key-one" },
      );
      expect(res.status).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when no proxy keys are configured", async () => {
    const res = await app.request(
      "/v1/models",
      { headers: { "x-api-key": "" } },
      { ...env, PROXY_API_KEYS: " , " },
    );
    expect(res.status).toBe(500);
  });

  it("rewrites auth, betas, and system before forwarding", async () => {
    const fetchMock = stubUpstream();
    const res = await messages(
      { model: "claude-sonnet-5-5", system: "Be terse.", messages: [] },
      {
        "anthropic-beta": "context-1m-2025-08-07, oauth-2025-04-20",
        cookie: "secret=1",
        "x-forwarded-for": "203.0.113.1",
      },
    );
    expect(res.status).toBe(200);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://upstream.test/v1/messages?beta=true");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer sk-ant-oat01-test");
    expect(headers.get("x-api-key")).toBeNull();
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(headers.get("anthropic-beta")).toBe(
      "oauth-2025-04-20,claude-code-20250219,context-1m-2025-08-07",
    );
    const body = JSON.parse(String(init?.body));
    expect(body.system[0].text).toBe(CLAUDE_CODE_IDENTITY);
    expect(body.system[1].text).toBe("Be terse.");
  });

  it.each(["/v1/messages", "/v1/messages/count_tokens"])(
    "strips only a leading anthropic/ model prefix on %s",
    async (path) => {
      for (const [model, expected] of [
        ["anthropic/claude-opus-5-5", "claude-opus-5-5"],
        ["claude-opus-5-5", "claude-opus-5-5"],
        ["other/claude-opus-5-5", "other/claude-opus-5-5"],
        ["other/anthropic/claude-opus-5-5", "other/anthropic/claude-opus-5-5"],
      ]) {
        const fetchMock = stubUpstream();
        const res = await app.request(
          path,
          {
            method: "POST",
            headers: { "x-api-key": "key-one" },
            body: JSON.stringify({ model, messages: [] }),
          },
          env,
        );
        expect(res.status).toBe(200);
        const [, init] = fetchMock.mock.calls[0] ?? [];
        expect(JSON.parse(String(init?.body)).model).toBe(expected);
      }
    },
  );

  it.each([
    { path: "/v1/messages", stream: false, speed: "fast" },
    { path: "/v1/messages", stream: true, speed: "fast" },
    { path: "/v1/messages/count_tokens", speed: "fast" },
    { path: "/v1/messages", speed: "standard" },
    { path: "/v1/messages" },
  ])(
    "disables fast mode without changing other options: %j",
    async (options) => {
      const fetchMock = stubUpstream();
      const body = {
        model: "claude-opus-5-5",
        max_tokens: 64,
        messages: [{ role: "user", content: "Hello" }],
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        stream: options.stream,
        speed: options.speed,
      };
      const res = await app.request(
        options.path,
        {
          method: "POST",
          headers: {
            "x-api-key": "key-one",
            "anthropic-beta":
              "fast-mode-2026-02-01, context-1m-2025-08-07, fast-mode-2099-01-01",
          },
          body: JSON.stringify(body),
        },
        env,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      const [url, init] = fetchMock.mock.calls[0] ?? [];
      expect(url).toBe(`https://upstream.test${options.path}`);
      const forwarded = JSON.parse(String(init?.body));
      expect(forwarded).toMatchObject({
        model: "claude-opus-5-5",
        max_tokens: 64,
        messages: [{ role: "user", content: "Hello" }],
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
      });
      expect(forwarded.stream).toBe(options.stream);
      if (options.speed === "standard") {
        expect(forwarded.speed).toBe("standard");
      } else {
        expect(forwarded).not.toHaveProperty("speed");
      }
      expect(new Headers(init?.headers).get("anthropic-beta")).toBe(
        "oauth-2025-04-20,claude-code-20250219,context-1m-2025-08-07",
      );
    },
  );

  it("accepts bearer keys and strips account headers from responses", async () => {
    stubUpstream(
      new Response("event: ping\n\n", {
        status: 429,
        headers: {
          "content-type": "text/event-stream",
          "anthropic-organization-id": "org",
          "anthropic-ratelimit-unified-status": "rejected",
        },
      }),
    );
    const res = await app.request(
      "/v1/messages",
      {
        method: "POST",
        headers: { authorization: "Bearer key-one" },
        body: JSON.stringify({ model: "m", stream: true, messages: [] }),
      },
      env,
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("anthropic-organization-id")).toBeNull();
    expect(res.headers.get("anthropic-ratelimit-unified-status")).toBe(
      "rejected",
    );
    expect(await res.text()).toBe("event: ping\n\n");
  });

  it("rejects malformed bodies", async () => {
    const fetchMock = stubUpstream();
    for (const body of ["not json", "[]", '{"system": 5}']) {
      const res = await app.request(
        "/v1/messages",
        { method: "POST", headers: { "x-api-key": "key-one" }, body },
        env,
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ type: "error" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
