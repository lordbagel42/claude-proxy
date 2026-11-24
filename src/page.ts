/** Public usage dashboard. Renders client-side from /stats.json. */
export const STATS_PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claude Usage</title>
<meta name="description" content="Live usage for claude.raygen.dev: tokens, tools, models, latency and subscription limits.">
<style>
:root {
  color-scheme: light;
  --bg: #f5f4f1; --surface: #fcfcfb; --border: #e4e3df; --grid: #ebeae6;
  --text: #0b0b0b; --text-2: #52514e; --text-3: #6f6e69;
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100;
  --good: #0ca30c; --warn: #fab219; --crit: #d03b3b;
  --track: #ebeae6;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #121211; --surface: #1a1a19; --border: #2d2d2b; --grid: #262624;
    --text: #f0efec; --text-2: #c3c2b7; --text-3: #9a998f;
    --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500;
    --track: #2d2d2b;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #121211; --surface: #1a1a19; --border: #2d2d2b; --grid: #262624;
  --text: #f0efec; --text-2: #c3c2b7; --text-3: #9a998f;
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500;
  --track: #2d2d2b;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-variant-numeric: tabular-nums;
}
main { max-width: 1180px; margin: 0 auto; padding: 24px 16px 48px; }
header { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: end; justify-content: space-between; margin-bottom: 20px; }
h1 { font-size: 22px; margin: 0; letter-spacing: -0.01em; }
h2 { font-size: 13px; font-weight: 600; margin: 0 0 12px; color: var(--text-2); text-transform: uppercase; letter-spacing: 0.04em; }
.sub { color: var(--text-3); font-size: 13px; margin-top: 2px; }
.tabs { display: flex; gap: 2px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 3px; }
.tabs button { border: 0; background: none; color: var(--text-2); font: inherit; font-size: 13px; padding: 5px 10px; border-radius: 6px; cursor: pointer; }
.tabs button[aria-pressed="true"] { background: var(--text); color: var(--surface); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; min-width: 0; }
.grid { display: grid; gap: 12px; margin-bottom: 12px; }
.tiles { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
.tile .label { color: var(--text-2); font-size: 12px; }
.tile .value { font-size: 24px; font-weight: 600; letter-spacing: -0.02em; margin-top: 2px; }
.tile .note { color: var(--text-3); font-size: 12px; }
.two { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
.three { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.meter { margin-bottom: 14px; }
.meter:last-child { margin-bottom: 0; }
.meter .row { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
.meter .bar { height: 8px; background: var(--track); border-radius: 4px; margin: 6px 0 4px; overflow: hidden; }
.meter .fill { height: 100%; border-radius: 4px; }
.meter .note { color: var(--text-3); font-size: 12px; }
.badge { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-2); }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--text-2); margin-bottom: 8px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.sw { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.chart { position: relative; }
.chart svg { display: block; width: 100%; height: 220px; overflow: visible; }
.chart text { fill: var(--text-3); font-size: 11px; }
.tip { position: absolute; pointer-events: none; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 12px; box-shadow: 0 4px 16px rgb(0 0 0 / 0.12); white-space: nowrap; z-index: 2; display: none; }
.tip b { display: block; margin-bottom: 4px; color: var(--text); }
.tip div { display: flex; align-items: center; gap: 6px; color: var(--text-2); }
.tip div span:last-child { margin-left: auto; padding-left: 12px; color: var(--text); }
.chart-head { display: flex; justify-content: space-between; align-items: start; gap: 8px; }
.link { background: none; border: 0; color: var(--text-2); font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; padding: 0; }
.list { list-style: none; margin: 0; padding: 0; }
.list li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; padding: 6px 0; border-top: 1px solid var(--grid); font-size: 13px; }
.list li:first-child { border-top: 0; }
.list .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list .val { color: var(--text-2); text-align: right; }
.list .bar { grid-column: 1 / -1; height: 4px; background: var(--track); border-radius: 2px; overflow: hidden; }
.list .bar i { display: block; height: 100%; background: var(--s1); border-radius: 2px; }
.list .meta { grid-column: 1 / -1; color: var(--text-3); font-size: 12px; }
.empty { color: var(--text-3); font-size: 13px; }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
th, td { text-align: left; padding: 7px 10px 7px 0; border-top: 1px solid var(--grid); white-space: nowrap; }
th { color: var(--text-3); font-weight: 500; border-top: 0; }
td.num, th.num { text-align: right; }
.err { color: var(--crit); }
footer { color: var(--text-3); font-size: 12px; margin-top: 20px; }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Claude Usage</h1>
      <div class="sub" id="updated">Loading…</div>
    </div>
    <div class="tabs" role="group" aria-label="Time range" id="tabs"></div>
  </header>

  <section class="grid tiles" id="tiles"></section>

  <section class="grid two">
    <div class="card">
      <h2>Subscription limits</h2>
      <div id="limits"></div>
    </div>
    <div class="card">
      <div class="chart-head"><h2>Requests</h2></div>
      <div class="chart" id="requests-chart"></div>
    </div>
  </section>

  <section class="grid">
    <div class="card">
      <div class="chart-head"><h2>Tokens</h2><button class="link" id="table-toggle">Show table</button></div>
      <div class="legend" id="token-legend"></div>
      <div class="chart" id="tokens-chart"></div>
      <div class="table-wrap" id="tokens-table" hidden></div>
    </div>
  </section>

  <section class="grid">
    <div class="card">
      <div class="chart-head"><h2>API cost equivalent</h2></div>
      <div class="chart" id="cost-chart"></div>
    </div>
  </section>

  <section class="grid three">
    <div class="card"><h2>Tools called</h2><ul class="list" id="tools"></ul></div>
    <div class="card"><h2>Models</h2><ul class="list" id="models"></ul></div>
    <div class="card"><h2>Clients</h2><ul class="list" id="clients"></ul></div>
    <div class="card"><h2>Stop reasons</h2><ul class="list" id="stopReasons"></ul></div>
    <div class="card"><h2>Errors</h2><ul class="list" id="errorTypes"></ul></div>
    <div class="card"><h2>Thinking</h2><ul class="list" id="thinking"></ul></div>
    <div class="card"><h2>Effort</h2><ul class="list" id="effort"></ul></div>
  </section>

  <section class="grid">
    <div class="card">
      <h2>Recent requests</h2>
      <div class="table-wrap" id="recent"></div>
    </div>
  </section>

  <footer>Metadata only: no prompts or completions are stored. Data from <a href="/stats.json" style="color:inherit">/stats.json</a>; refreshes every minute.</footer>
</main>
<script>
(() => {
  const RANGES = ["24h", "7d", "30d", "90d", "365d"];
  const SERIES = [
    { key: "input_tokens", name: "Input", color: "var(--s1)" },
    { key: "output_tokens", name: "Output", color: "var(--s2)" },
    { key: "cache_read", name: "Cache read", color: "var(--s3)" },
    { key: "cache_write", name: "Cache write", color: "var(--s4)" },
  ];
  let range = "30d";
  try { range = localStorage.getItem("range") || range; } catch {}
  if (!RANGES.includes(range)) range = "30d";

  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "style") node.style.cssText = v;
      else if (k === "class") node.className = v;
      else node.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null) node.append(kid instanceof Node ? kid : String(kid));
    return node;
  };
  const svg = (tag, attrs = {}) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const n = (v) => Number(v) || 0;
  const compact = (v) => {
    v = n(v);
    if (Math.abs(v) < 1000) return String(Math.round(v));
    return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  };
  const usd = (v) => {
    v = n(v);
    const digits = v > 0 && v < 1 ? 4 : 2;
    return "$" + v.toLocaleString("en", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };
  const full = (v) => new Intl.NumberFormat("en").format(Math.round(n(v)));
  const ms = (v) => v == null ? "–" : n(v) >= 1000 ? (n(v) / 1000).toFixed(1) + "s" : Math.round(n(v)) + "ms";
  const pct = (v) => (n(v) * 100).toFixed(n(v) < 0.1 ? 1 : 0) + "%";
  const ago = (ts) => {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  };
  const until = (epochSec) => {
    const s = Math.round(epochSec - Date.now() / 1000);
    if (s <= 0) return "now";
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    if (h >= 24) return Math.floor(h / 24) + "d " + (h % 24) + "h";
    return h ? h + "h " + m + "m" : m + "m";
  };
  const when = (ts, bucketMs) => {
    const d = new Date(ts);
    return bucketMs < 86400000
      ? d.toLocaleTimeString([], { hour: "numeric" })
      : d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  function tabs() {
    const box = $("tabs");
    box.replaceChildren(...RANGES.map((r) => {
      const b = el("button", { type: "button", "aria-pressed": String(r === range) }, r);
      b.onclick = () => { range = r; try { localStorage.setItem("range", r); } catch {} tabs(); load(); };
      return b;
    }));
  }

  function tiles(t, days) {
    t = t || {};
    const req = n(t.requests);
    const items = [
      ["API cost equivalent", usd(t.cost_usd), n(t.unpriced) ? n(t.unpriced) + " requests on unpriced models" : "at pay-as-you-go API prices"],
      ["Requests", compact(req), full(req) + " in " + days],
      ["Input tokens", compact(t.input_tokens), full(t.input_tokens)],
      ["Output tokens", compact(t.output_tokens), full(t.output_tokens)],
      ["Cache read", compact(t.cache_read), full(t.cache_read)],
      ["Cache write", compact(t.cache_write), full(t.cache_write)],
      ["Tool calls", compact(t.tool_calls), req ? (n(t.tool_calls) / req).toFixed(1) + " per request" : ""],
      ["Web searches", compact(t.web_searches), ""],
      ["Errors", compact(t.errors), req ? pct(n(t.errors) / req) + " of requests" : ""],
      ["Avg latency", ms(t.avg_ms), "max " + ms(t.max_ms)],
      ["Avg first token", ms(t.avg_ttft_ms), "streamed requests"],
      ["Messages sent", compact(t.messages), req ? (n(t.messages) / req).toFixed(1) + " per request" : ""],
      ["Request payload", compact(t.request_bytes) + "B", ""],
    ];
    $("tiles").replaceChildren(...items.map(([l, v, note]) =>
      el("div", { class: "card tile" }, el("div", { class: "label" }, l), el("div", { class: "value" }, v), el("div", { class: "note" }, note))));
  }

  function limits(rl) {
    const box = $("limits");
    if (!rl) { box.replaceChildren(el("p", { class: "empty" }, "No rate-limit data yet.")); return; }
    const meter = (label, util, reset) => {
      const u = Math.max(0, Math.min(1, n(util)));
      const color = u >= 0.9 ? "var(--crit)" : u >= 0.7 ? "var(--warn)" : "var(--good)";
      const state = u >= 0.9 ? "Critical" : u >= 0.7 ? "High" : "OK";
      return el("div", { class: "meter" },
        el("div", { class: "row" }, el("span", {}, label), el("strong", {}, util == null ? "–" : pct(u))),
        el("div", { class: "bar", role: "meter", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(u * 100)), "aria-label": label },
          el("div", { class: "fill", style: "width:" + (u * 100) + "%;background:" + color })),
        el("div", { class: "note" }, state + (reset ? " · resets in " + until(reset) : "")));
    };
    box.replaceChildren(
      meter("5-hour window", rl.rl_5h, rl.rl_5h_reset),
      meter("7-day window", rl.rl_7d, rl.rl_7d_reset),
      el("div", { class: "note", style: "color:var(--text-3);font-size:12px" },
        "Status: " + (rl.rl_status || "–") + " · extra usage: " + (rl.rl_overage || "–") + " · as of " + ago(rl.ts)),
    );
  }

  function fillBuckets(rows, since, now, bucketMs) {
    const map = new Map(rows.map((r) => [n(r.bucket), r]));
    const out = [];
    for (let b = Math.floor(since / bucketMs) * bucketMs; b <= now; b += bucketMs) out.push(map.get(b) || { bucket: b });
    return out;
  }

  function barChart(box, rows, series, bucketMs, fmt) {
    const axis = fmt || compact, value = fmt || full;
    const tip = el("div", { class: "tip" });
    const W = 1000, H = 220, L = 44, R = 4, T = 8, B = 22;
    const totals = rows.map((r) => series.reduce((s, x) => s + n(r[x.key]), 0));
    const max = Math.max(1, ...totals);
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((v) => v * 4 >= max) || step * 10;
    const top = nice * 4 >= max ? nice * 4 : max;
    const root = svg("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none", role: "img" });
    const y = (v) => T + (H - T - B) * (1 - v / top);
    for (let i = 0; i <= 4; i++) {
      const v = (top / 4) * i;
      root.append(svg("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: "var(--grid)", "stroke-width": 1, "vector-effect": "non-scaling-stroke" }));
      const t = svg("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }); t.textContent = axis(v); root.append(t);
    }
    const slot = (W - L - R) / Math.max(1, rows.length);
    const bw = Math.max(1, Math.min(28, slot - 2));
    const labelEvery = Math.ceil(rows.length / 8);
    rows.forEach((r, i) => {
      const x = L + slot * i + (slot - bw) / 2;
      let acc = 0;
      const segs = series.filter((s) => n(r[s.key]) > 0);
      segs.forEach((s, j) => {
        const v = n(r[s.key]);
        const y1 = y(acc + v), y0 = y(acc);
        // 2px surface gap between stacked segments.
        const h = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0));
        const isTop = j === segs.length - 1;
        if (isTop) {
          const rr = Math.min(4, bw / 2, h);
          root.append(svg("path", { fill: s.color, d: "M" + x + "," + (y1 + h) + "V" + (y1 + rr) + "Q" + x + "," + y1 + " " + (x + rr) + "," + y1 + "H" + (x + bw - rr) + "Q" + (x + bw) + "," + y1 + " " + (x + bw) + "," + (y1 + rr) + "V" + (y1 + h) + "Z" }));
        } else {
          root.append(svg("rect", { x, y: y1, width: bw, height: h, fill: s.color }));
        }
        acc += v;
      });
      if (i % labelEvery === 0) {
        const t = svg("text", { x: L + slot * i + slot / 2, y: H - 6, "text-anchor": "middle" });
        t.textContent = when(n(r.bucket), bucketMs); root.append(t);
      }
      const hit = svg("rect", { x: L + slot * i, y: T, width: slot, height: H - T - B, fill: "transparent" });
      hit.addEventListener("mouseenter", () => {
        tip.replaceChildren(el("b", {}, new Date(n(r.bucket)).toLocaleString([], bucketMs < 86400000 ? { month: "short", day: "numeric", hour: "numeric" } : { weekday: "short", month: "short", day: "numeric" })),
          ...series.map((s) => el("div", {}, el("span", { class: "sw", style: "background:" + s.color }), el("span", {}, s.name), el("span", {}, value(r[s.key])))));
        tip.style.display = "block";
      });
      hit.addEventListener("mousemove", (e) => {
        const b = box.getBoundingClientRect();
        const left = e.clientX - b.left + 12;
        tip.style.left = Math.min(left, b.width - tip.offsetWidth) + "px";
        tip.style.top = Math.max(0, e.clientY - b.top - tip.offsetHeight - 8) + "px";
      });
      hit.addEventListener("mouseleave", () => { tip.style.display = "none"; });
      root.append(hit);
    });
    const label = series.map((s) => s.name).join(", ") + " per " + (bucketMs < 86400000 ? "hour" : "day");
    root.setAttribute("aria-label", label);
    box.replaceChildren(root, tip);
  }

  function tokenTable(rows, bucketMs) {
    const head = el("tr", {}, el("th", {}, "Period"), ...SERIES.map((s) => el("th", { class: "num" }, s.name)), el("th", { class: "num" }, "Requests"));
    const body = rows.filter((r) => n(r.requests)).reverse().map((r) =>
      el("tr", {}, el("td", {}, when(n(r.bucket), bucketMs)), ...SERIES.map((s) => el("td", { class: "num" }, full(r[s.key]))), el("td", { class: "num" }, full(r.requests))));
    $("tokens-table").replaceChildren(el("table", {}, el("thead", {}, head), el("tbody", {}, ...body)));
  }

  function list(id, rows, valueKey, fmt, meta) {
    const box = $(id);
    if (!rows || !rows.length) { box.replaceChildren(el("li", { class: "empty" }, "Nothing yet.")); return; }
    const max = Math.max(1, ...rows.map((r) => n(r[valueKey])));
    box.replaceChildren(...rows.map((r) => el("li", {},
      el("span", { class: "name", title: String(r.name) }, String(r.name)),
      el("span", { class: "val" }, fmt(r)),
      el("span", { class: "bar" }, el("i", { style: "width:" + (n(r[valueKey]) / max * 100) + "%" })),
      meta ? el("span", { class: "meta" }, meta(r)) : null)));
  }
  const reqMeta = (r) => usd(r.cost_usd) + " · " + compact(r.input_tokens) + " in · " + compact(r.output_tokens) + " out · " + compact(r.cache_read) + " cached · " + ms(r.avg_ms) + " avg" + (n(r.errors) ? " · " + r.errors + " errors" : "");

  function recent(rows) {
    const cols = ["When", "Model", "Client", "Status", "Stop", "Input", "Output", "Cache r/w", "Cost", "Tools", "Thinking", "Latency", "TTFT"];
    const head = el("tr", {}, ...cols.map((c, i) => el("th", { class: i >= 5 && i !== 9 && i !== 10 ? "num" : "" }, c)));
    const body = (rows || []).map((r) => {
      let tools = [];
      try { tools = JSON.parse(r.tool_names || "[]"); } catch {}
      const toolText = tools.length ? tools.length + " (" + [...new Set(tools)].slice(0, 3).join(", ") + (new Set(tools).size > 3 ? "…" : "") + ")" : "–";
      return el("tr", {},
        el("td", { title: new Date(n(r.ts)).toLocaleString() }, ago(n(r.ts))),
        el("td", {}, r.model || "–"),
        el("td", {}, r.client || "–"),
        el("td", { class: n(r.status) >= 400 ? "err" : "" }, String(r.status) + (r.error_type ? " " + r.error_type : "")),
        el("td", {}, r.stop_reason || "–"),
        el("td", { class: "num" }, full(r.input_tokens)),
        el("td", { class: "num" }, full(r.output_tokens)),
        el("td", { class: "num" }, compact(r.cache_read) + " / " + compact(r.cache_write)),
        el("td", { class: "num" }, r.cost_usd == null ? "–" : usd(r.cost_usd)),
        el("td", {}, toolText),
        el("td", {}, (r.thinking || "–") + (r.effort ? " · " + r.effort : "")),
        el("td", { class: "num" }, ms(r.ms)),
        el("td", { class: "num" }, ms(r.ttft_ms)));
    });
    $("recent").replaceChildren(body.length ? el("table", {}, el("thead", {}, head), el("tbody", {}, ...body)) : el("p", { class: "empty" }, "No requests yet."));
  }

  $("token-legend").replaceChildren(...SERIES.map((s) => el("span", {}, el("span", { class: "sw", style: "background:" + s.color }), s.name)));
  $("table-toggle").onclick = () => {
    const t = $("tokens-table"); t.hidden = !t.hidden;
    $("table-toggle").textContent = t.hidden ? "Show table" : "Hide table";
  };

  async function load() {
    try {
      const res = await fetch("/stats.json?range=" + encodeURIComponent(range));
      if (!res.ok) throw new Error("HTTP " + res.status);
      const d = await res.json();
      const days = range === "24h" ? "24 hours" : range.replace("d", " days");
      const rows = fillBuckets(d.series || [], d.since, d.now, d.bucketMs);
      tiles(d.totals, days);
      limits(d.rateLimit);
      barChart($("tokens-chart"), rows, SERIES, d.bucketMs);
      barChart($("cost-chart"), rows, [{ key: "cost_usd", name: "API cost (USD)", color: "var(--s1)", fmt: usd }], d.bucketMs, usd);
      barChart($("requests-chart"), rows, [{ key: "requests", name: "Requests", color: "var(--s1)" }], d.bucketMs);
      tokenTable(rows, d.bucketMs);
      list("tools", d.tools, "calls", (r) => full(r.calls) + " calls", (r) => "in " + full(r.requests) + " requests");
      for (const id of ["models", "clients", "stopReasons", "thinking", "effort"]) list(id, d[id], "requests", (r) => full(r.requests), reqMeta);
      list("errorTypes", d.errorTypes, "requests", (r) => full(r.requests));
      recent(d.recent);
      $("updated").textContent = "Last " + days + " · updated " + new Date().toLocaleTimeString();
    } catch (e) {
      $("updated").textContent = "Could not load stats (" + e.message + ")";
    }
  }

  tabs();
  load();
  setInterval(load, 60000);
})();
</script>
</body>
</html>`;
