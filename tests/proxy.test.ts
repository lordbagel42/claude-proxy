import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareBody } from "../src/body";
import type { Env } from "../src/env";
import app from "../src/index";
import { CLAUDE_CODE_IDENTITY } from "../src/upstream";

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

function sent(init: RequestInit | undefined): string {
  return new TextDecoder().decode(init?.body as Uint8Array);
}

describe("prepareBody", () => {
  const identity = { type: "text", text: CLAUDE_CODE_IDENTITY };
  const rewrite = (raw: string) => {
    const prepared = prepareBody(new TextEncoder().encode(raw));
    return {
      ...prepared,
      body: JSON.parse(new TextDecoder().decode(prepared.payload)),
    };
  };

  it("shapes the body while keeping everything else byte-for-byte", () => {
    const cases: [string, unknown][] = [
      ["{}", [identity]],
      ['{ "system" : null }', [identity]],
      ['{"system":""}', [identity]],
      [
        '{"system":"Be \\"terse\\"."}',
        [identity, { type: "text", text: 'Be "terse".' }],
      ],
      ['{"system":[]}', [identity]],
      [
        '{"system":[{"type":"text","text":"x"}]}',
        [identity, { type: "text", text: "x" }],
      ],
    ];
    for (const [raw, system] of cases) {
      expect(rewrite(raw).body.system).toEqual(system);
    }
    const tail = '"messages":[{"role":"user","content":"a,b]}["}],"x":1';
    const { body, messages } = rewrite(
      `{"speed":"fast", "model" :"Anthropic/claude-haiku-4-5",${tail}}`,
    );
    expect(body).toEqual({
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "a,b]}[" }],
      x: 1,
      system: [identity],
    });
    expect(messages).toBe(1);
    expect(rewrite('{"a":1,"speed":"fast"}').body).toEqual({
      a: 1,
      system: [identity],
    });
    expect(rewrite('{"speed":"fast"}').body).toEqual({ system: [identity] });

    const untouched = `{"system":[${JSON.stringify(identity)}], "tools":[{},{}]}`;
    const prepared = rewrite(untouched);
    expect(new TextDecoder().decode(prepared.payload)).toBe(untouched);
    expect(prepared.toolsOffered).toBe(2);
  });

  it("rejects bodies it cannot shape safely", () => {
    for (const raw of [
      "[]",
      "{",
      '{"a":1}x',
      '{"a":[}',
      '{"system":1}',
      '{"model":"a","model":"b"}',
    ]) {
      expect(() => prepareBody(new TextEncoder().encode(raw))).toThrow();
    }
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
      {
        model: "anthropic/claude-sonnet-5-5",
        system: "Be terse.",
        messages: [],
      },
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
    const body = JSON.parse(sent(init));
    expect(body.model).toBe("claude-sonnet-5-5");
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
        expect(JSON.parse(sent(init)).model).toBe(expected);
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
      const forwarded = JSON.parse(sent(init));
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

describe("named keys and analytics", () => {
  function dataset() {
    const points: AnalyticsEngineDataPoint[] = [];
    return {
      points,
      writeDataPoint: (p?: AnalyticsEngineDataPoint) => p && points.push(p),
    };
  }

  it("accepts PROXY_KEY_<NAME> alongside legacy keys and fails closed without either", async () => {
    stubUpstream();
    const named: Env = {
      ...env,
      PROXY_API_KEYS: undefined,
      PROXY_KEY_PI: "pi-key",
    };
    const ok = await app.request(
      "/v1/models",
      { headers: { "x-api-key": "pi-key" } },
      named,
    );
    expect(ok.status).toBe(200);
    const legacy = await app.request(
      "/v1/models",
      { headers: { "x-api-key": "key-one" } },
      named,
    );
    expect(legacy.status).toBe(401);
    const none = await app.request(
      "/v1/models",
      { headers: { "x-api-key": "x" } },
      { ...named, PROXY_KEY_PI: " " },
    );
    expect(none.status).toBe(500);
  });

  it("records key name and usage for JSON and streamed messages", async () => {
    const analytics = dataset();
    const named = {
      ...env,
      PROXY_KEY_PI: "pi-key",
      ANALYTICS: analytics as unknown as AnalyticsEngineDataset,
    };
    stubUpstream(
      Response.json({
        usage: {
          input_tokens: 7,
          output_tokens: 3,
          cache_read_input_tokens: 2,
        },
      }),
    );
    await app.request(
      "/v1/messages",
      {
        method: "POST",
        headers: { "x-api-key": "pi-key" },
        body: JSON.stringify({ model: "claude-haiku-5-5", messages: [] }),
      },
      named,
    );

    const sse = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":11,"output_tokens":1,"cache_creation_input_tokens":4}}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"input_tokens":null,"cache_creation_input_tokens":0,"output_tokens":9}}\n\n',
    ].join("");
    stubUpstream(
      new Response(sse, { headers: { "content-type": "text/event-stream" } }),
    );
    const res = await app.request(
      "/v1/messages",
      {
        method: "POST",
        headers: { "x-api-key": "key-two" },
        body: JSON.stringify({ model: "m", stream: true, messages: [] }),
      },
      named,
    );
    expect(await res.text()).toBe(sse);

    expect(analytics.points).toEqual([
      {
        indexes: ["pi"],
        blobs: ["pi", "/v1/messages", "claude-haiku-5-5", "json"],
        doubles: [200, expect.any(Number), 7, 3, 2, 0],
      },
      {
        indexes: ["legacy-2"],
        blobs: ["legacy-2", "/v1/messages", "m", "stream"],
        doubles: [200, expect.any(Number), 11, 9, 0, 4],
      },
    ]);
  });
});

describe("stats rows", () => {
  it("stores tools, stop reason, rate limits and request settings, but no content", async () => {
    const rows: Record<string, unknown>[] = [];
    const store = {
      record: async (row: Record<string, unknown>) => {
        rows.push(row);
      },
    };
    const stats = {
      idFromName: () => "id",
      get: () => store,
    } as unknown as NonNullable<Env["STATS"]>;
    const sse = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":20,"cache_read_input_tokens":5}}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","name":"bash","input":{}}}\n\n',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","name":"read","input":{}}}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":12}}\n\n',
    ].join("");
    stubUpstream(
      new Response(sse, {
        headers: {
          "content-type": "text/event-stream",
          "anthropic-ratelimit-unified-5h-utilization": "0.25",
          "anthropic-ratelimit-unified-status": "allowed",
        },
      }),
    );
    const res = await app.request(
      "/v1/messages",
      {
        method: "POST",
        headers: { "x-api-key": "key-one", "user-agent": "pi (darwin)" },
        body: JSON.stringify({
          model: "claude-haiku-5-5",
          stream: true,
          max_tokens: 1000,
          thinking: { type: "enabled", budget_tokens: 500 },
          tools: [{ name: "bash" }, { name: "read" }, { name: "edit" }],
          messages: [{ role: "user", content: "SECRET PROMPT" }],
        }),
      },
      { ...env, STATS: stats },
    );
    await res.text();
    await new Promise((r) => setTimeout(r, 0));
    expect(rows).toHaveLength(1);
    const row = rows[0] ?? {};
    expect(JSON.stringify(row)).not.toContain("SECRET");
    expect(row).toMatchObject({
      key: "legacy-1",
      model: "claude-haiku-5-5",
      client: "pi",
      stop_reason: "tool_use",
      tool_names: '["bash","read"]',
      thinking: "enabled",
      rl_5h: 0.25,
      rl_status: "allowed",
      input_tokens: 20,
      output_tokens: 12,
      cache_read: 5,
      tools_offered: 3,
      tool_calls: 2,
    });
    // Haiku 5.5: 20 x $0.10 + 12 x $0.50 + 5 x $0.01 per MTok
    expect(row.cost_usd).toBeCloseTo(0.00000805);
  });
});

describe("apiCost", () => {
  it("prices tokens per model, including Haiku's long-prompt tier", async () => {
    const { apiCost } = await import("../src/pricing");
    const usage = {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cacheCreation: 1_000_000,
    };
    // Opus 5.5: 4 + 20 + 0.2 + 5
    expect(apiCost("claude-opus-5-5", usage)).toBeCloseTo(29.2);
    // Haiku 5.5 above 100K prompt tokens: 0.5 + 2.5 + 0.05 + 0.625
    expect(apiCost("claude-haiku-5-5", usage)).toBeCloseTo(3.675);
    expect(
      apiCost("claude-haiku-5-5", {
        input: 1000,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
      }),
    ).toBeCloseTo(0.0001);
    expect(
      apiCost("claude-haiku-4-5-20251001", {
        ...usage,
        cacheRead: 0,
        cacheCreation: 0,
      }),
    ).toBeCloseTo(6);
    expect(apiCost("mystery-model", usage)).toBeUndefined();
  });
});
