import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { RelayError } from "@/lib/config";
import { shared } from "@/lib/events";
import { WS_ID } from "@/lib/core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 3700;

/** SSE stream for the dashboard. Resumes from Last-Event-ID using the durable events table. */
export async function GET(req: Request) {
  let wsId: string;
  try {
    wsId = (await requireUser(req)).workspaceId;
  } catch (e) {
    if (e instanceof RelayError) return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
    throw e;
  }
  // Only this workspace's events: in-process bus events carry their workspace, and the durable replay is
  // filtered in SQL. Legacy rows (workspace_id null) belong to the default workspace only.
  const inWs = (id?: string | null) => id === wsId || (wsId === WS_ID && (id ?? null) === null);
  const enc = new TextEncoder();
  const lastId = Number(req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("last_event_id")) || 0;
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (id: number, type: string, payload: unknown) => {
        try {
          controller.enqueue(enc.encode(`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {}
      };
      controller.enqueue(enc.encode("retry: 2000\n: connected\n\n"));
      let cursor = lastId;
      const queue: { id: number; type: string; payload: unknown }[] = [];
      let replaying = true;
      const onEvent = (e: { id: number; type: string; payload: unknown; workspaceId?: string | null }) => {
        if (!inWs(e.workspaceId)) return;
        if (replaying) queue.push(e);
        else if (e.id > cursor) {
          cursor = e.id;
          send(e.id, e.type, e.payload);
        }
      };
      shared.bus.on("event", onEvent);
      if (lastId) {
        const scope = wsId === WS_ID ? or(eq(events.workspaceId, wsId), isNull(events.workspaceId)) : eq(events.workspaceId, wsId);
        const missed = await db.select().from(events).where(and(gt(events.id, lastId), scope)).orderBy(asc(events.id)).limit(500);
        for (const m of missed) {
          cursor = m.id;
          send(m.id, m.type, m.payload);
        }
      } else {
        const [latest] = await db.select({ id: events.id }).from(events).orderBy(asc(events.id)).limit(1);
        void latest;
      }
      replaying = false;
      for (const e of queue) if (e.id > cursor) onEvent(e);
      const ping = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 15000);
      cleanup = () => {
        clearInterval(ping);
        shared.bus.off("event", onEvent);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}
