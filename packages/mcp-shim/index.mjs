#!/usr/bin/env node
// agentrelay-mcp — stdio → remote Streamable HTTP MCP shim (zero dependencies, Node 18+).
// Key feature (Addendum B.2 path 1): `wait_for_message` with timeout 0/unset is turned into
// internal chunks, so the agent's tool call stays open "forever" while physical connections are short.
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const opt = (name, env, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return process.env[env] ?? def;
};
const URL_ = opt("url", "AGENTRELAY_URL");
const TOKEN = opt("token", "AGENTRELAY_TOKEN");
const CHUNK = Number(opt("chunk", "AGENTRELAY_CHUNK_SECONDS", "30"));
const PROGRESS_MS = Number(opt("progress", "AGENTRELAY_PROGRESS_SECONDS", "10")) * 1000;
if (argv.includes("--help") || !URL_ || !TOKEN) {
  console.error("Usage: agentrelay-mcp --url https://relay.example.com/mcp --token ar_live_xxx [--chunk 30] [--progress 10]\n(or env AGENTRELAY_URL / AGENTRELAY_TOKEN)");
  process.exit(argv.includes("--help") ? 0 : 2);
}
const log = (...a) => console.error("[agentrelay-mcp]", ...a);
const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const sleep = (ms, signal) =>
  new Promise((res) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); res(); }, { once: true });
  });

class FatalHttp extends Error {}
let sessionId = null;
const active = new Map(); // request id -> AbortController

async function postOnce(msg, signal, onMsg) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${TOKEN}` };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(URL_, { method: "POST", headers, body: JSON.stringify(msg), signal });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  if (res.status === 202) return;
  if (res.status === 401 || res.status === 403) throw new FatalHttp(`HTTP ${res.status}: unauthorized (token revoked or invalid)`);
  if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
  if (!res.ok) throw new FatalHttp(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, "");
        const data = raw.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
        if (data) onMsg(JSON.parse(data));
      }
    }
  } else {
    const j = await res.json();
    for (const m of Array.isArray(j) ? j : [j]) onMsg(m);
  }
}

/** Forward a request with limited retries, always answering the client. */
async function forward(msg) {
  const ctrl = new AbortController();
  if (msg.id !== undefined) active.set(msg.id, ctrl);
  let answered = false;
  try {
    for (let attempt = 0; attempt < 4 && !ctrl.signal.aborted; attempt++) {
      try {
        await postOnce(msg, ctrl.signal, (m) => {
          if (m.id !== undefined && m.id === msg.id) answered = true;
          send(m);
        });
        return;
      } catch (e) {
        if (ctrl.signal.aborted || e instanceof FatalHttp || answered) throw e;
        await sleep(Math.min(1000 * 2 ** attempt, 8000), ctrl.signal);
      }
    }
  } catch (e) {
    if (msg.id !== undefined && !ctrl.signal.aborted && !answered) send({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: String(e.message ?? e) } });
  } finally {
    if (msg.id !== undefined) active.delete(msg.id);
  }
}

async function runWait(msg) {
  const ctrl = new AbortController();
  active.set(msg.id, ctrl);
  const token = msg.params?._meta?.progressToken;
  let progress = 0;
  const timer =
    token !== undefined
      ? setInterval(() => send({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: token, progress: ++progress, message: "waiting for message" } }), PROGRESS_MS)
      : null;
  let backoff = 1000;
  let n = 0;
  try {
    while (!ctrl.signal.aborted) {
      const chunkMsg = {
        jsonrpc: "2.0",
        id: `shim-${msg.id}-${n++}`,
        method: "tools/call",
        params: { name: "wait_for_message", arguments: { ...msg.params.arguments, timeout_seconds: CHUNK, _chunk: true } },
      };
      let result = null;
      let rpcError = null;
      try {
        await postOnce(chunkMsg, ctrl.signal, (m) => {
          if (m.id === chunkMsg.id) {
            if (m.error) rpcError = m.error;
            else result = m.result;
          }
        });
        backoff = 1000;
      } catch (e) {
        if (ctrl.signal.aborted) return;
        if (e instanceof FatalHttp) {
          send({ jsonrpc: "2.0", id: msg.id, error: { code: -32001, message: String(e.message) } });
          return;
        }
        log(`connection problem (${e.message}); retrying in ${backoff / 1000}s`);
        await sleep(backoff, ctrl.signal);
        backoff = Math.min(backoff * 2, 30000);
        continue;
      }
      if (rpcError || !result) {
        await sleep(backoff, ctrl.signal);
        backoff = Math.min(backoff * 2, 30000);
        continue;
      }
      const sc = result.structuredContent;
      if (result.isError) {
        const ra = sc?.error?.retry_after;
        if (sc?.error?.code === "rate_limited" || sc?.error?.code === "too_many_waits") {
          await sleep((ra ?? 5) * 1000, ctrl.signal);
          continue;
        }
        send({ jsonrpc: "2.0", id: msg.id, result });
        return;
      }
      if (sc?.status === "timeout") continue; // chunk expired → reconnect transparently
      send({ jsonrpc: "2.0", id: msg.id, result });
      return;
    }
  } finally {
    if (timer) clearInterval(timer);
    active.delete(msg.id);
  }
}

const rl = createInterface({ input: process.stdin });
const pending = new Set();
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return log("ignoring non-JSON line");
  }
  if (msg.method === "notifications/cancelled") {
    const c = active.get(msg.params?.requestId);
    if (c) c.abort();
    return;
  }
  let p;
  if (msg.method === "tools/call" && msg.params?.name === "wait_for_message" && msg.id !== undefined && !msg.params.arguments?.timeout_seconds) p = runWait(msg);
  else p = forward(msg);
  pending.add(p);
  p.finally(() => pending.delete(p));
});
rl.on("close", async () => {
  for (const c of active.values()) c.abort();
  await Promise.allSettled([...pending]);
  process.exit(0);
});
process.on("SIGTERM", () => process.exit(0));
