#!/usr/bin/env node
// Scenarios 15 & 19: server restart must not lose pending messages; a shim wait survives the restart without
// surfacing an error to the agent; direct (HTTP) waits are answered with `timeout` on graceful shutdown.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const PORT = process.env.RESTART_PORT ?? "3101";
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: process.env.ADMIN_EMAIL ?? "admin@test.local", password: process.env.ADMIN_PASSWORD ?? "test-password-123" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sfx = Math.random().toString(36).slice(2, 7);
let server;
const results = [];
const check = (name, ok, info = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${info}`);
};

function start() {
  server = spawn("npx", ["next", "start", "-p", PORT], { env: { ...process.env, PORT, ...ADMIN }, stdio: "ignore", detached: true });
}
async function ready() {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(`${BASE}/readyz`)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("server did not become ready");
}
const killServer = (sig) => new Promise((res) => {
  server.on("exit", res);
  try { process.kill(-server.pid, sig); } catch { res(); }
  setTimeout(res, 8000);
});

let cookie = "", csrf = "";
async function api(method, path, body) {
  const r = await fetch(`${BASE}/api/v1/${path}`, { method, headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  return { headers: r.headers, ...j };
}
async function login() {
  const me = await api("GET", "auth/me");
  const r = me.needs_setup ? await api("POST", "auth/setup", { ...ADMIN, name: "Admin" }) : await api("POST", "auth/login", ADMIN);
  cookie = r.headers.get("set-cookie").split(";")[0];
  csrf = r.csrf;
}
async function tool(token, name, args, timeoutMs = 60000) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  const data = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)));
  return (data[0] ?? JSON.parse(text)).result.structuredContent;
}
const mk = async (n) => {
  const r = await api("POST", "agents", { name: `r${sfx}${n}` });
  return { name: `r${sfx}${n}`, token: r.token };
};

(async () => {
  start();
  await ready();
  await login();
  const [A, B, C, D] = [await mk("a"), await mk("b"), await mk("c"), await mk("d")];

  // pending message survives restart (S15)
  await tool(A.token, "send_message", { to: B.name, content: "pending across restart" });

  // C listens through the shim, D listens directly over HTTP
  const shim = spawn("node", ["packages/mcp-shim/index.mjs", "--url", `${BASE}/mcp`, "--token", C.token, "--chunk", "3"], { stdio: ["pipe", "pipe", "inherit"] });
  const out = [];
  createInterface({ input: shim.stdout }).on("line", (l) => out.push(JSON.parse(l)));
  shim.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } } }) + "\n");
  await sleep(800);
  shim.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "wait_for_message", arguments: {} } }) + "\n");
  const directWait = tool(D.token, "wait_for_message", { timeout_seconds: 0 });
  await sleep(1500);

  console.log("→ SIGTERM server (graceful) …");
  await killServer("SIGTERM");
  const dres = await directWait.catch((e) => ({ error: String(e) }));
  check("S19/FR-22f graceful shutdown answers direct wait with timeout + call-again", dres.status === "timeout" && /again/.test(dres.next_action), JSON.stringify(dres).slice(0, 120));
  await sleep(2500); // shim retries against a dead server meanwhile
  check("shim shows no error to the agent while the server is down", !out.some((m) => m.id === 2));

  console.log("→ restarting server …");
  start();
  await ready();
  await sleep(300);
  await tool(A.token, "send_message", { to: C.name, content: "sent after restart" });
  const t0 = Date.now();
  while (!out.some((m) => m.id === 2) && Date.now() - t0 < 40000) await sleep(200);
  const got = out.find((m) => m.id === 2);
  check("S19 shim reconnected and delivered post-restart message", got?.result?.structuredContent?.messages?.[0]?.content === "sent after restart", `(${Date.now() - t0}ms after restart)`);

  const r = await tool(B.token, "wait_for_message", { timeout_seconds: 3 });
  check("S15 pending message persisted across restart", r.status === "message" && r.messages[0].content === "pending across restart");

  shim.kill();
  await killServer("SIGTERM");
  const ok = results.every(Boolean);
  console.log(ok ? "\nRESTART CHECK: ALL PASSED" : "\nRESTART CHECK: FAILURES");
  process.exit(ok ? 0 : 1);
})().catch(async (e) => {
  console.error(e);
  try { await killServer("SIGKILL"); } catch {}
  process.exit(1);
});
