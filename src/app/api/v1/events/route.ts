import { gt, asc } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { RelayError } from "@/lib/config";
import { shared } from "@/lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 3700;

/** SSE stream for the dashboard. Resumes from Last-Event-ID using the durable events table. */
export async function GET(req: Request) {
  try {
    await requireUser(req);
  } catch (e) {
    if (e instanceof RelayError) return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
    throw e;
  }
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
      const onEvent = (e: { id: number; type: string; payload: unknown }) => {
        if (replaying) queue.push(e);
        else if (e.id > cursor) {
          cursor = e.id;
          send(e.id, e.type, e.payload);
        }
      };
      shared.bus.on("event", onEvent);
      if (lastId) {
        const missed = await db.select().from(events).where(gt(events.id, lastId)).orderBy(asc(events.id)).limit(500);
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
