import { apiCost } from "./pricing";
import type { StatsRow } from "./stats";
import type { StatsStore } from "./store";

/**
 * Per-request metadata: what was asked for, what came back, and how long it
 * took. Only counts and labels are recorded, never prompt or completion text.
 *
 * Each request is written to Workers Analytics Engine (see the README for the
 * data point layout) and, when the STATS binding exists, as one row in the
 * StatsStore Durable Object that powers the public stats page.
 */

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  webSearches: number;
}

/** Facts known before forwarding, taken from the client request. */
export interface RequestFacts {
  keyName: string;
  path: string;
  model?: string;
  client?: string;
  stream: boolean;
  maxTokens?: number;
  thinking?: string;
  thinkingBudget?: number;
  effort?: string;
  toolsOffered: number;
  messages: number;
  requestBytes: number;
}

export interface RateLimit {
  status?: string;
  overage?: string;
  util5h?: number;
  util7d?: number;
  reset5h?: number;
  reset7d?: number;
}

/** Facts learned from the upstream response. */
export interface ResponseFacts {
  status: number;
  ms: number;
  ttftMs?: number;
  errorType?: string;
  stopReason?: string;
  usage?: Usage;
  toolCalls: string[];
  rateLimit: RateLimit;
}

export type RequestRecord = RequestFacts & ResponseFacts;

export function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreation: 0,
    webSearches: 0,
  };
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Caps client-supplied labels so a hostile value cannot bloat storage. */
export function label(value: unknown, max = 128): string | undefined {
  return typeof value === "string" && value ? value.slice(0, max) : undefined;
}

/**
 * Folds an Anthropic `usage` object into `usage`. Output tokens are cumulative,
 * so the latest value wins; input and cache counts keep the largest value
 * seen, because `message_delta` may repeat them as `null` or 0.
 */
export function applyUsage(usage: Usage, raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const u = raw as Record<string, unknown>;
  const output = count(u.output_tokens);
  if (output !== undefined) usage.output = output;
  usage.input = Math.max(usage.input, count(u.input_tokens) ?? 0);
  usage.cacheRead = Math.max(
    usage.cacheRead,
    count(u.cache_read_input_tokens) ?? 0,
  );
  usage.cacheCreation = Math.max(
    usage.cacheCreation,
    count(u.cache_creation_input_tokens) ?? 0,
  );
  const server = u.server_tool_use as Record<string, unknown> | undefined;
  usage.webSearches = Math.max(
    usage.webSearches,
    count(server?.web_search_requests) ?? 0,
  );
}

/** Extracts request facts without keeping any message or tool content. */
export function requestFacts(
  keyName: string,
  path: string,
  body: Record<string, unknown>,
  counts: { toolsOffered: number; messages: number },
  headers: Headers,
  requestBytes: number,
): RequestFacts {
  const thinking = body.thinking as Record<string, unknown> | undefined;
  const output = body.output_config as Record<string, unknown> | undefined;
  const userAgent = headers.get("user-agent") ?? "";
  return {
    keyName,
    path,
    model: label(body.model),
    client: label(userAgent.split(/[\s/(]/)[0], 64),
    stream: body.stream === true,
    maxTokens: count(body.max_tokens),
    thinking: label(thinking?.type, 32),
    thinkingBudget: count(thinking?.budget_tokens),
    effort: label(output?.effort ?? body.effort, 32),
    toolsOffered: counts.toolsOffered,
    messages: counts.messages,
    requestBytes,
  };
}

function headerNumber(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Reads the subscription's unified rate-limit headers. */
export function rateLimit(headers: Headers): RateLimit {
  const prefix = "anthropic-ratelimit-unified-";
  return {
    status: label(headers.get(`${prefix}status`), 32),
    overage: label(headers.get(`${prefix}overage-status`), 32),
    util5h: headerNumber(headers, `${prefix}5h-utilization`),
    util7d: headerNumber(headers, `${prefix}7d-utilization`),
    reset5h: headerNumber(headers, `${prefix}5h-reset`),
    reset7d: headerNumber(headers, `${prefix}7d-reset`),
  };
}

/** Accumulates response facts from a message or a stream of SSE events. */
export class Meter {
  usage = emptyUsage();
  seenUsage = false;
  toolCalls: string[] = [];
  stopReason?: string;
  errorType?: string;
  firstTokenAt?: number;

  /** A complete (non-streamed) Messages API response or error body. */
  message(json: unknown): void {
    if (!json || typeof json !== "object") return;
    const m = json as Record<string, unknown>;
    if (m.type === "error") {
      const error = m.error as Record<string, unknown> | undefined;
      this.errorType = label(error?.type, 64);
      return;
    }
    if (m.usage) {
      applyUsage(this.usage, m.usage);
      this.seenUsage = true;
    }
    this.stopReason = label(m.stop_reason, 64) ?? this.stopReason;
    if (Array.isArray(m.content)) {
      for (const block of m.content) this.block(block);
    }
  }

  private block(raw: unknown): void {
    const block = raw as Record<string, unknown> | undefined;
    if (!block || typeof block.type !== "string") return;
    if (block.type.endsWith("tool_use")) {
      this.toolCalls.push(label(block.name, 64) ?? block.type);
    }
  }

  /** One parsed SSE `data:` payload. */
  event(event: Record<string, unknown>, now: number): void {
    switch (event.type) {
      case "message_start":
        this.message(event.message);
        break;
      case "content_block_start":
        this.firstTokenAt ??= now;
        this.block(event.content_block);
        break;
      case "content_block_delta":
        this.firstTokenAt ??= now;
        break;
      case "message_delta": {
        applyUsage(this.usage, event.usage);
        this.seenUsage = true;
        const delta = event.delta as Record<string, unknown> | undefined;
        this.stopReason = label(delta?.stop_reason, 64) ?? this.stopReason;
        break;
      }
      case "error":
        this.message(event);
        break;
    }
  }
}

/**
 * Passes an SSE body through unchanged while feeding each event to `meter`.
 * `onDone` runs once the stream ends, errors, or is cancelled by the client.
 */
export function meterStream(
  body: ReadableStream<Uint8Array>,
  meter: Meter,
  onDone: () => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onDone();
  };
  const scan = (line: string) => {
    if (!line.startsWith("data:")) return;
    try {
      const event: unknown = JSON.parse(line.slice(5));
      if (event && typeof event === "object") {
        meter.event(event as Record<string, unknown>, Date.now());
      }
    } catch {
      // Not JSON (e.g. a ping payload); ignore.
    }
  };

  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          if (buffer) scan(buffer.trim());
          controller.close();
          finish();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        // An SSE line longer than this is not one we need to read.
        if (buffer.length > 1_000_000) buffer = "";
        for (const line of lines) scan(line.trim());
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        finish();
      }
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason);
    },
  });
}

export function responseFacts(
  meter: Meter,
  status: number,
  headers: Headers,
  started: number,
): ResponseFacts {
  return {
    status,
    ms: Date.now() - started,
    ttftMs:
      meter.firstTokenAt === undefined
        ? undefined
        : meter.firstTokenAt - started,
    errorType: meter.errorType,
    stopReason: meter.stopReason,
    usage: meter.seenUsage ? meter.usage : undefined,
    toolCalls: meter.toolCalls,
    rateLimit: rateLimit(headers),
  };
}

interface Bindings {
  ANALYTICS?: AnalyticsEngineDataset;
  STATS?: DurableObjectNamespace<StatsStore>;
}

/** Maps a record onto the `requests` table's columns. */
export function statsRow(record: RequestRecord, now = Date.now()): StatsRow {
  const usage = record.usage ?? emptyUsage();
  const rl = record.rateLimit;
  return {
    ts: now,
    key: record.keyName,
    path: record.path,
    model: record.model ?? null,
    client: record.client ?? null,
    stream: record.stream ? 1 : 0,
    status: record.status,
    error_type: record.errorType ?? null,
    stop_reason: record.stopReason ?? null,
    ms: record.ms,
    ttft_ms: record.ttftMs ?? null,
    input_tokens: usage.input,
    output_tokens: usage.output,
    cache_read: usage.cacheRead,
    cache_write: usage.cacheCreation,
    web_searches: usage.webSearches,
    cost_usd: record.usage ? (apiCost(record.model, usage) ?? null) : null,
    max_tokens: record.maxTokens ?? null,
    thinking: record.thinking ?? null,
    thinking_budget: record.thinkingBudget ?? null,
    effort: record.effort ?? null,
    tools_offered: record.toolsOffered,
    tool_calls: record.toolCalls.length,
    tool_names: JSON.stringify(record.toolCalls.slice(0, 100)),
    messages: record.messages,
    request_bytes: record.requestBytes,
    rl_status: rl.status ?? null,
    rl_overage: rl.overage ?? null,
    rl_5h: rl.util5h ?? null,
    rl_7d: rl.util7d ?? null,
    rl_5h_reset: rl.reset5h ?? null,
    rl_7d_reset: rl.reset7d ?? null,
  };
}

/** The single stats store instance. */
export function statsStore(namespace: DurableObjectNamespace<StatsStore>) {
  return namespace.get(namespace.idFromName("global"));
}

/** Logs the record and writes it to Analytics Engine and the stats store. */
export async function writeRecord(
  env: Bindings,
  record: RequestRecord,
): Promise<void> {
  const usage = record.usage ?? emptyUsage();
  console.log(
    JSON.stringify({
      event: "request",
      key: record.keyName,
      path: record.path,
      model: record.model,
      stream: record.stream,
      status: record.status,
      ms: record.ms,
      ...(record.usage ? { usage } : {}),
    }),
  );
  try {
    env.ANALYTICS?.writeDataPoint({
      indexes: [record.keyName],
      blobs: [
        record.keyName,
        record.path,
        record.model ?? "",
        record.stream ? "stream" : "json",
      ],
      doubles: [
        record.status,
        record.ms,
        usage.input,
        usage.output,
        usage.cacheRead,
        usage.cacheCreation,
      ],
    });
  } catch (error) {
    console.error(
      JSON.stringify({ event: "analytics_failed", error: `${error}` }),
    );
  }
  if (!env.STATS) return;
  try {
    await statsStore(env.STATS).record(statsRow(record));
  } catch (error) {
    console.error(JSON.stringify({ event: "stats_failed", error: `${error}` }));
  }
}
