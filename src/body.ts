import { CLAUDE_CODE_IDENTITY, normalizeModel } from "./upstream";

/**
 * Rewrites a Messages API request body without parsing it as a whole.
 *
 * Claude Code bodies are routinely around a megabyte. Parsing one into an
 * object tree and serialising it again costs several times its size in
 * memory, and concurrent requests share one isolate's 128 MB limit. Instead,
 * the raw bytes are scanned once for top-level members; only small fields are
 * parsed, `messages` and `tools` are just counted, and edits are spliced into
 * the original bytes.
 */

/** Top-level fields small enough to parse and needed for shaping or facts. */
const PARSED_FIELDS = new Set([
  "model",
  "system",
  "speed",
  "stream",
  "max_tokens",
  "thinking",
  "output_config",
  "effort",
]);
const COUNTED_FIELDS = new Set(["messages", "tools"]);

const IDENTITY_BLOCK = JSON.stringify({
  type: "text",
  text: CLAUDE_CODE_IDENTITY,
});

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const COLON = 0x3a;
const OPEN_OBJECT = 0x7b;
const CLOSE_OBJECT = 0x7d;
const OPEN_ARRAY = 0x5b;
const CLOSE_ARRAY = 0x5d;

interface Member {
  key: string;
  /** Index of the `{` or `,` preceding the member. */
  sep: number;
  keyStart: number;
  start: number;
  end: number;
  /** Element count when the value is an array. */
  items: number;
}

interface Patch {
  start: number;
  end: number;
  text: string;
}

export interface PreparedBody {
  payload: Uint8Array;
  /** Parsed values of the small fields listed in PARSED_FIELDS. */
  fields: Record<string, unknown>;
  messages: number;
  toolsOffered: number;
}

const invalid = () => new SyntaxError("Request body is not valid JSON.");

function isSpace(b: number | undefined): boolean {
  return b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09;
}

function skipSpace(bytes: Uint8Array, i: number): number {
  while (isSpace(bytes[i])) i++;
  return i;
}

/** Returns the index just past the string starting at `i`. */
function skipString(bytes: Uint8Array, i: number): number {
  let from = i + 1;
  for (;;) {
    const quote = bytes.indexOf(QUOTE, from);
    if (quote < 0) throw invalid();
    let k = quote - 1;
    while (bytes[k] === BACKSLASH) k--;
    if ((quote - 1 - k) % 2 === 0) return quote + 1;
    from = quote + 1;
  }
}

/** Returns the end of the value at `i` and its element count if an array. */
function skipValue(bytes: Uint8Array, i: number): [number, number] {
  const first = bytes[i];
  if (first === QUOTE) return [skipString(bytes, i), 0];
  if (first !== OPEN_OBJECT && first !== OPEN_ARRAY) {
    let j = i;
    while (j < bytes.length) {
      const b = bytes[j];
      if (b === COMMA || b === CLOSE_OBJECT || b === CLOSE_ARRAY || isSpace(b))
        break;
      j++;
    }
    if (j === i) throw invalid();
    return [j, 0];
  }
  const stack: number[] = [];
  let commas = 0;
  let empty = true;
  for (let j = i; j < bytes.length; j++) {
    const b = bytes[j];
    if (b === QUOTE) {
      if (stack.length === 1) empty = false;
      j = skipString(bytes, j) - 1;
    } else if (b === OPEN_OBJECT || b === OPEN_ARRAY) {
      if (stack.length === 1) empty = false;
      stack.push(b === OPEN_OBJECT ? CLOSE_OBJECT : CLOSE_ARRAY);
    } else if (b === CLOSE_OBJECT || b === CLOSE_ARRAY) {
      if (stack.pop() !== b) throw invalid();
      if (stack.length === 0) {
        return [j + 1, first === OPEN_ARRAY && !empty ? commas + 1 : 0];
      }
    } else if (stack.length === 1) {
      if (b === COMMA) commas++;
      else if (!isSpace(b)) empty = false;
    }
  }
  throw invalid();
}

const decoder = new TextDecoder();

function parseSpan(bytes: Uint8Array, start: number, end: number): unknown {
  return JSON.parse(decoder.decode(bytes.subarray(start, end)));
}

/** Splits a top-level JSON object into its members. */
function members(bytes: Uint8Array): { list: Member[]; close: number } {
  let i = skipSpace(bytes, 0);
  if (bytes[i] !== OPEN_OBJECT) {
    throw new TypeError("body must be a JSON object");
  }
  const list: Member[] = [];
  let sep = i;
  i = skipSpace(bytes, i + 1);
  let close = i;
  if (bytes[i] !== CLOSE_OBJECT) {
    for (;;) {
      if (bytes[i] !== QUOTE) throw invalid();
      const keyStart = i;
      const keyEnd = skipString(bytes, i);
      const key = parseSpan(bytes, keyStart, keyEnd) as string;
      i = skipSpace(bytes, keyEnd);
      if (bytes[i] !== COLON) throw invalid();
      const start = skipSpace(bytes, i + 1);
      const [end, items] = skipValue(bytes, start);
      list.push({ key, sep, keyStart, start, end, items });
      i = skipSpace(bytes, end);
      if (bytes[i] === COMMA) {
        sep = i;
        i = skipSpace(bytes, i + 1);
        continue;
      }
      if (bytes[i] !== CLOSE_OBJECT) throw invalid();
      close = i;
      break;
    }
  }
  if (skipSpace(bytes, close + 1) !== bytes.length) throw invalid();
  return { list, close };
}

function splice(bytes: Uint8Array, patches: Patch[]): Uint8Array {
  if (patches.length === 0) return bytes;
  // Stable sort: insertions at a position stay ahead of a removal there.
  patches.sort((a, b) => a.start - b.start || a.end - b.end);
  const encoder = new TextEncoder();
  const encoded = patches.map((p) => ({ ...p, data: encoder.encode(p.text) }));
  let length = bytes.length;
  for (const p of encoded) length += p.data.length - (p.end - p.start);
  const out = new Uint8Array(length);
  let read = 0;
  let write = 0;
  for (const p of encoded) {
    out.set(bytes.subarray(read, p.start), write);
    write += p.start - read;
    out.set(p.data, write);
    write += p.data.length;
    read = p.end;
  }
  out.set(bytes.subarray(read), write);
  return out;
}

/**
 * Applies the request shaping described in docs/upstream.md: the Claude Code
 * identity as the first system block, no `anthropic/` model prefix, and no
 * fast speed.
 */
export function prepareBody(bytes: Uint8Array): PreparedBody {
  const { list, close } = members(bytes);
  const fields: Record<string, unknown> = {};
  const found = new Map<string, Member>();
  let messages = 0;
  let toolsOffered = 0;
  for (const member of list) {
    const parsed = PARSED_FIELDS.has(member.key);
    if (!parsed && !COUNTED_FIELDS.has(member.key)) continue;
    if (found.has(member.key)) {
      throw new TypeError(`duplicate "${member.key}" field`);
    }
    found.set(member.key, member);
    if (parsed) {
      fields[member.key] = parseSpan(bytes, member.start, member.end);
    } else if (member.key === "messages") {
      messages = member.items;
    } else {
      toolsOffered = member.items;
    }
  }

  const patches: Patch[] = [];
  let removed = 0;

  const model = found.get("model");
  if (model && typeof fields.model === "string") {
    const normalized = normalizeModel(fields.model);
    if (normalized !== fields.model) {
      fields.model = normalized;
      patches.push({
        start: model.start,
        end: model.end,
        text: JSON.stringify(normalized),
      });
    }
  }

  // Omitting fast mode selects the upstream's standard speed.
  const speed = found.get("speed");
  if (speed && fields.speed === "fast") {
    delete fields.speed;
    removed++;
    const index = list.indexOf(speed);
    const next = list[index + 1];
    if (bytes[speed.sep] === COMMA) {
      patches.push({ start: speed.sep, end: speed.end, text: "" });
    } else if (next) {
      patches.push({ start: speed.keyStart, end: next.sep + 1, text: "" });
    } else {
      patches.push({ start: speed.keyStart, end: speed.end, text: "" });
    }
  }

  const system = found.get("system");
  const value = fields.system;
  if (!system) {
    const comma = list.length - removed > 0 ? "," : "";
    patches.push({
      start: close,
      end: close,
      text: `${comma}"system":[${IDENTITY_BLOCK}]`,
    });
  } else if (value === null || value === "") {
    patches.push({
      start: system.start,
      end: system.end,
      text: `[${IDENTITY_BLOCK}]`,
    });
  } else if (typeof value === "string") {
    patches.push(
      {
        start: system.start,
        end: system.start,
        text: `[${IDENTITY_BLOCK},{"type":"text","text":`,
      },
      { start: system.end, end: system.end, text: "}]" },
    );
  } else if (Array.isArray(value)) {
    const first = value[0] as { type?: unknown; text?: unknown } | undefined;
    if (first?.type !== "text" || first.text !== CLAUDE_CODE_IDENTITY) {
      patches.push({
        start: system.start + 1,
        end: system.start + 1,
        text: value.length > 0 ? `${IDENTITY_BLOCK},` : IDENTITY_BLOCK,
      });
    }
  } else {
    throw new TypeError(
      "system must be a string or an array of content blocks",
    );
  }

  return {
    payload: splice(bytes, patches),
    fields,
    messages,
    toolsOffered,
  };
}
