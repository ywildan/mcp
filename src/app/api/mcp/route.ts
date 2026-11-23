import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateToken, ensureWorkspace } from "@/lib/core";
import { config, log } from "@/lib/config";
import { buildMcpServer } from "@/lib/mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 3700;

const jsonErr = (status: number, code: number, message: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), { status, headers: { "content-type": "application/json", ...extra } });

/** Inject SSE comment pings so idle proxies keep a long-running wait open (Addendum B.2 path 2). */
function withKeepalive(res: Response, abort: AbortController, onClose: () => void): Response {
  if (!res.body || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    onClose();
    return res;
  }
  const reader = res.body.getReader();
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    onClose();
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": ping\n\n"));
        } catch {
          finish();
          abort.abort();
        }
      }, config.waitKeepaliveSeconds * 1000);
      (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        } catch (e) {
          try {
            controller.error(e);
          } catch {}
        } finally {
          finish();
        }
      })();
    },
    cancel() {
      // client disconnected → free the waiter immediately (FR-22c)
      finish();
      abort.abort();
      reader.cancel().catch(() => {});
    },
  });
  const headers = new Headers(res.headers);
  headers.set("cache-control", "no-cache, no-transform");
  headers.set("x-accel-buffering", "no");
  return new Response(stream, { status: res.status, headers });
}

export async function POST(req: Request) {
  await ensureWorkspace();
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  const agent = m ? await authenticateToken(m[1].trim()) : null;
  if (!agent) return jsonErr(401, -32001, "Unauthorized: provide a valid 'Authorization: Bearer ar_live_...' token", { "www-authenticate": 'Bearer realm="agentrelay"' });

  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  const server = buildMcpServer({ agent, signal: abort.signal });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  const cleanup = () => {
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  };
  try {
    const res = await transport.handleRequest(req);
    return withKeepalive(res, abort, cleanup);
  } catch (e) {
    cleanup();
    log("error", "mcp_request_failed", { err: String(e) });
    return jsonErr(500, -32603, "Internal error");
  }
}

// Stateless server: no standalone GET stream / session delete.
export async function GET() {
  return jsonErr(405, -32000, "Method not allowed: this MCP endpoint is stateless; use POST", { allow: "POST" });
}
export async function DELETE() {
  return new Response(null, { status: 204 });
}
