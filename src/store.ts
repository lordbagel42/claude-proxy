import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import {
  collectStats,
  insertSql,
  RETENTION_MS,
  rangeDays,
  SCHEMA,
  type StatsRow,
} from "./stats";

/** Single SQLite-backed Durable Object holding per-request stats rows. */
export class StatsStore extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(SCHEMA);
  }

  private cache = new Map<string, { at: number; value: unknown }>();

  record(row: StatsRow): void {
    const [sql, values] = insertSql(row);
    this.ctx.storage.sql.exec(sql, ...values);
    // Occasionally drop rows older than the longest range the page shows.
    if (Math.random() < 0.01) {
      this.ctx.storage.sql.exec(
        "DELETE FROM requests WHERE ts < ?",
        Date.now() - RETENTION_MS,
      );
    }
  }

  /** Aggregates are memoised briefly so public page hits stay cheap. */
  stats(range: string | undefined) {
    const [name] = rangeDays(range);
    const hit = this.cache.get(name);
    if (hit && Date.now() - hit.at < 30_000) return hit.value;
    const value = this.compute(name);
    this.cache.set(name, { at: Date.now(), value });
    return value;
  }

  private compute(range: string) {
    return collectStats(
      (sql, ...bindings) =>
        this.ctx.storage.sql.exec(sql, ...bindings).toArray() as Record<
          string,
          unknown
        >[],
      range,
    );
  }
}
