import { EventEmitter } from "node:events";
import { lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { log } from "./config";
import { RateLimiter } from "./pure";

export interface Waiter {
  agentId: string;
  startedAt: number;
  interrupted: string | null;
  wake: () => void;
  interrupt: (reason: string) => void;
}

// Process-wide singletons (shared across Next route bundles via globalThis).
interface Shared {
  bus: EventEmitter;
  waiters: Map<string, Waiter>;
  rate: RateLimiter;
  shuttingDown: boolean;
  shutdownHooked: boolean;
  lastPrune: number;
}
const g = globalThis as typeof globalThis & { __agentRelay?: Shared };
export const shared: Shared = (g.__agentRelay ??= {
  bus: (() => {
    const b = new EventEmitter();
    b.setMaxListeners(0);
    return b;
  })(),
  waiters: new Map(),
  rate: new RateLimiter(),
  shuttingDown: false,
  shutdownHooked: false,
  lastPrune: 0,
});

/** Persist + broadcast a dashboard event (SSE source of truth, supports Last-Event-ID). */
export async function publish(type: string, payload: Record<string, unknown>) {
  try {
    const [row] = await db.insert(events).values({ type, payload }).returning();
    shared.bus.emit("event", { id: row.id, type, payload });
    if (Date.now() - shared.lastPrune > 10 * 60_000) {
      shared.lastPrune = Date.now();
      await db.delete(events).where(lt(events.createdAt, sql`now() - interval '1 day'`));
    }
  } catch (e) {
    log("error", "publish_failed", { type, err: String(e) });
  }
}

export function notifyAgent(agentId: string) {
  shared.waiters.get(agentId)?.wake();
}

export function interruptWaiter(agentId: string, reason: string): boolean {
  const w = shared.waiters.get(agentId);
  if (!w) return false;
  w.interrupt(reason);
  return true;
}

export const hasWaiter = (agentId: string) => shared.waiters.has(agentId);
export const activeWaits = () => shared.waiters.size;

/** Graceful shutdown (FR-22f): finish every active wait with `timeout` + "call again". */
export function hookShutdown() {
  if (shared.shutdownHooked) return;
  shared.shutdownHooked = true;
  const handler = () => {
    shared.shuttingDown = true;
    for (const w of shared.waiters.values()) w.interrupt("shutdown");
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.once("SIGTERM", handler);
  process.once("SIGINT", handler);
}
