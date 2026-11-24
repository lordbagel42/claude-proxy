/**
 * Per-request usage analytics written to Workers Analytics Engine.
 *
 * Only counts and labels are recorded, never prompt or completion text.
 * Data point layout (keep in sync with the README queries):
 *   index1  key name
 *   blob1   key name     blob2  path    blob3  model    blob4  "stream" | "json"
 *   double1 status       double2 duration ms
 *   double3 input tokens double4 output tokens
 *   double5 cache read   double6 cache creation input tokens
 */

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface RequestRecord {
  keyName: string;
  path: string;
  model?: string;
  stream: boolean;
  status: number;
  ms: number;
  usage?: Usage;
}

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
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
}

/** Caps client-supplied labels below Analytics Engine's blob size limit. */
function label(value: string | undefined): string {
  return (value ?? "").slice(0, 256);
}

export function writeRecord(
  dataset: AnalyticsEngineDataset | undefined,
  record: RequestRecord,
): void {
  const usage = record.usage ?? emptyUsage();
  console.log(
    JSON.stringify({
      event: "request",
      key: record.keyName,
      path: record.path,
      model: record.model === undefined ? undefined : label(record.model),
      stream: record.stream,
      status: record.status,
      ms: record.ms,
      ...(record.usage ? { usage } : {}),
    }),
  );
  if (!dataset) return;
  try {
    dataset.writeDataPoint({
      indexes: [record.keyName],
      blobs: [
        record.keyName,
        record.path,
        label(record.model),
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
}

/**
 * Passes an SSE body through unchanged while reading `usage` from
 * `message_start` and `message_delta` events. `onDone` runs once the stream
 * ends, errors, or is cancelled by the client.
 */
export function meterStream(
  body: ReadableStream<Uint8Array>,
  onDone: (usage: Usage | undefined) => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const usage = emptyUsage();
  let seen = false;
  let buffer = "";
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onDone(seen ? usage : undefined);
  };
  const scan = (line: string) => {
    if (!line.startsWith("data:")) return;
    try {
      const event = JSON.parse(line.slice(5)) as Record<string, unknown>;
      if (event.type === "message_start") {
        const message = event.message as Record<string, unknown> | undefined;
        applyUsage(usage, message?.usage);
        seen = true;
      } else if (event.type === "message_delta") {
        applyUsage(usage, event.usage);
        seen = true;
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
          if (buffer) scan(buffer.trim());
          controller.close();
          finish();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
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
