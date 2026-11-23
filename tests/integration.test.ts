 
import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.RELAY_URL ?? "http://127.0.0.1:3100";
const ADMIN = { email: process.env.ADMIN_EMAIL ?? "admin@test.local", password: process.env.ADMIN_PASSWORD ?? "test-password-123" };
const sfx = randomBytes(3).toString("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

let cookie = "";
let csrf = "";
async function api(method: string, path: string, body?: unknown, auth = true) {
  const r = await fetch(`${BASE}/api/v1/${path}`, {
    method,
    headers: { "content-type": "application/json", ...(auth ? { cookie, "x-csrf-token": csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j: any = await r.json().catch(() => ({}));
  return { status: r.status, headers: r.headers, ...j } as any;
}

interface Ag {
  name: string;
  id: string;
  token: string;
  tokenId: string;
  c: Client;
}
const clients: Client[] = [];
let n = 0;
async function mkAgent(opts: Record<string, unknown> = {}): Promise<Ag> {
  const name = `t${sfx}${n++}`;
  const r = await api("POST", "agents", { name, type: "custom", ...opts });
  expect(r.status).toBe(200);
  const c = new Client({ name: "test", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${r.token}` } } }));
  clients.push(c);
  return { name, id: r.agent.id, token: r.token, tokenId: r.token_id, c };
}
const call = async (a: Ag, name: string, args: any = {}, timeout = 120_000) =>
  (await a.c.callTool({ name, arguments: args }, undefined, { timeout })).structuredContent as any;
const pair = async () => [await mkAgent(), await mkAgent()] as const;
const setSettings = (s: Record<string, unknown>) => api("PATCH", "settings", s);

const children: ChildProcess[] = [];

beforeAll(async () => {
  const me = await api("GET", "auth/me", undefined, false);
  const r = me.needs_setup ? await api("POST", "auth/setup", { ...ADMIN, name: "Admin" }, false) : await api("POST", "auth/login", ADMIN, false);
  expect(r.status, JSON.stringify(r)).toBe(200);
  cookie = (r.headers.get("set-cookie") as string).split(";")[0];
  csrf = r.csrf;
  await setSettings({ hopLimit: 50, rateMsgPerMin: 600, rateCallsPerMin: 6000, leaseSeconds: 120 });
});
afterAll(async () => {
  children.forEach((c) => c.kill("SIGKILL"));
  await Promise.allSettled(clients.map((c) => c.close()));
  await setSettings({ hopLimit: 20, rateMsgPerMin: 60, rateCallsPerMin: 600, leaseSeconds: 120 });
});

describe("M0/M1 core messaging & wait loop", () => {
  it("S1 connection: whoami returns the right identity per token", async () => {
    const [A, B] = await pair();
    expect((await call(A, "whoami")).agent.name).toBe(A.name);
    expect((await call(B, "whoami")).agent.name).toBe(B.name);
    const tools = (await A.c.listTools()).tools.map((t) => t.name);
    for (const t of ["wait_for_message", "send_message", "ack_message", "create_task", "request_human_input", "upload_artifact"]) expect(tools).toContain(t);
    expect(A.c.getInstructions()).toContain("wait_for_message");
    expect(A.c.getServerVersion()?.name).toBe("agentrelay");
  });

  it("S2 basic loop: infinite wait receives in <1s, reply reaches waiting sender", async () => {
    const [A, B] = await pair();
    const waitB = call(B, "wait_for_message", { timeout_seconds: 0 });
    await sleep(600);
    const t0 = Date.now();
    await call(A, "send_message", { to: B.name, content: "hello B" });
    const r = await waitB;
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.status).toBe("message");
    expect(r.messages[0]).toMatchObject({ content: "hello B", from: { name: A.name, kind: "agent" }, redelivered: false });
    const waitA = call(A, "wait_for_message", {});
    await sleep(300);
    await call(B, "send_message", { to: A.name, content: "hi A", reply_to: r.messages[0].id });
    const r2 = await waitA;
    expect(r2.messages[0]).toMatchObject({ content: "hi A", reply_to: r.messages[0].id });
  });

  it("S3 timeout: returns timeout at configured time with correct next_action", async () => {
    const [A] = await pair();
    const t0 = Date.now();
    const r = await call(A, "wait_for_message", { timeout_seconds: 2 });
    const el = Date.now() - t0;
    expect(r.status).toBe("timeout");
    expect(el).toBeGreaterThan(1500);
    expect(el).toBeLessThan(3500);
    expect(r.next_action).toMatch(/wait_for_message again/);
  });

  it("S4 offline delivery: message sent while not waiting is received instantly", async () => {
    const [A, B] = await pair();
    await call(A, "send_message", { to: B.name, content: "while you were away" });
    expect((await call(B, "check_inbox")).pending_count).toBe(1);
    const t0 = Date.now();
    const r = await call(B, "wait_for_message", { timeout_seconds: 5 });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(r.messages).toHaveLength(1);
  });

  it("S5 at-least-once: redelivered after lease, gone after ack", async () => {
    const [A, B] = await pair();
    await setSettings({ leaseSeconds: 1 });
    try {
      await call(A, "send_message", { to: B.name, content: "needs ack" });
      const r1 = await call(B, "wait_for_message", { timeout_seconds: 3 });
      expect(r1.messages[0].redelivered).toBe(false);
      const none = await call(B, "wait_for_message", { timeout_seconds: 1 }); // lease still active (≈1s) or just expired
      void none;
      await sleep(1300);
      const r2 = await call(B, "wait_for_message", { timeout_seconds: 3 });
      expect(r2.messages[0]).toMatchObject({ id: r1.messages[0].id, redelivered: true });
      expect((await call(B, "ack_message", { message_ids: [r1.messages[0].id] })).acked).toEqual([r1.messages[0].id]);
      await sleep(1300);
      expect((await call(B, "wait_for_message", { timeout_seconds: 1 })).status).toBe("timeout");
    } finally {
      await setSettings({ leaseSeconds: 120 });
    }
  });

  it("S6/S21 single waiter: second wait supersedes first (interrupted), no double delivery", async () => {
    const [A, B] = await pair();
    const w1 = call(B, "wait_for_message", { timeout_seconds: 0 });
    await sleep(400);
    const w2 = call(B, "wait_for_message", { timeout_seconds: 0 });
    const r1 = await w1;
    expect(r1.status).toBe("interrupted");
    await call(A, "send_message", { to: B.name, content: "only once" });
    const r2 = await w2;
    expect(r2.status).toBe("message");
    expect(r2.messages).toHaveLength(1);
    expect((await call(B, "wait_for_message", { timeout_seconds: 1 })).status).toBe("timeout");
  });

  it("S8 mentions: only mentioned agents are triggered in mentions_only rooms", async () => {
    const [A, B] = await pair();
    const C = await mkAgent();
    const D = await mkAgent();
    const room = await api("POST", "rooms", { name: `proj-${sfx}${n}`, members: [A.name, B.name, C.name, D.name] });
    const rid = room.room.id;
    const [wb, wc, wd] = [B, C, D].map((x) => call(x, "wait_for_message", { timeout_seconds: 3 }));
    await sleep(400);
    const sent = await call(A, "send_message", { room_id: rid, content: `hey @${C.name} please look` });
    expect(sent.warnings).toEqual([]);
    const [rb, rc, rd] = await Promise.all([wb, wc, wd]);
    expect(rc.status).toBe("message");
    expect(rb.status).toBe("timeout");
    expect(rd.status).toBe("timeout");
  });

  it("S9 loop guard: pauses after hop_limit, banner state, human message resumes; Resume button works", async () => {
    const [A, B] = await pair();
    const room = await api("POST", "rooms", { name: `loop-${sfx}${n}`, members: [A.name, B.name], hop_limit: 4 });
    const rid = room.room.id;
    for (let i = 1; i <= 4; i++) {
      const s = await call(i % 2 ? A : B, "send_message", { room_id: rid, content: `ping ${i}` });
      expect(s.error).toBeUndefined();
      if (i === 4) expect(s.room_paused).toBe(true);
    }
    expect((await api("GET", `rooms/${rid}`)).room).toMatchObject({ state: "paused", pause_reason: "loop_guard" });
    const rej = await call(A, "send_message", { room_id: rid, content: "more?" });
    expect(rej.error.code).toBe("room_paused");
    const msgs = (await api("GET", `rooms/${rid}/messages`)).messages;
    expect(msgs.some((m: any) => m.type === "system" && /loop guard/i.test(m.content))).toBe(true);
    // human message continues the conversation
    expect((await api("POST", `rooms/${rid}/messages`, { content: "carry on" })).status).toBe(200);
    expect((await api("GET", `rooms/${rid}`)).room).toMatchObject({ state: "active", hop_count: 0 });
    expect((await call(A, "send_message", { room_id: rid, content: "ok continuing" })).error).toBeUndefined();
    // trip again, then Resume button
    for (let i = 0; i < 3; i++) await call(i % 2 ? A : B, "send_message", { room_id: rid, content: `again ${i}` });
    expect((await api("GET", `rooms/${rid}`)).room.state).toBe("paused");
    expect((await api("POST", `rooms/${rid}/resume`)).room.state).toBe("active");
    expect((await call(B, "send_message", { room_id: rid, content: "back" })).error).toBeUndefined();
  });

  it("S10/S20 kill switch: pause→paused, wake→interrupted, revoke→401", async () => {
    const [, B] = await pair();
    const w = call(B, "wait_for_message", { timeout_seconds: 0 });
    await sleep(400);
    expect((await api("GET", "agents")).agents.find((a: any) => a.id === B.id)).toMatchObject({ waiting: true, presence: "online" });
    expect((await api("POST", `agents/${B.id}/wake`)).interrupted).toBe(true);
    expect((await w).status).toBe("interrupted");
    const w2 = call(B, "wait_for_message", { timeout_seconds: 0 });
    await sleep(400);
    await api("POST", `agents/${B.id}/pause`);
    expect((await w2).status).toBe("paused");
    expect((await call(B, "wait_for_message", {})).status).toBe("paused");
    await api("POST", `agents/${B.id}/resume`);
    expect((await call(B, "wait_for_message", { timeout_seconds: 1 })).status).toBe("timeout");
    expect((await api("DELETE", `agents/${B.id}/tokens/${B.tokenId}`)).status).toBe(200);
    const res = await fetch(`${BASE}/mcp`, { method: "POST", headers: { authorization: `Bearer ${B.token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(res.status).toBe(401);
    // rotate issues a new working token and invalidates the old
    const [, C] = await pair();
    const rot = await api("POST", `agents/${C.id}/tokens`, { rotate: true });
    const old = await fetch(`${BASE}/mcp`, { method: "POST", headers: { authorization: `Bearer ${C.token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
    expect(old.status).toBe(401);
    expect(rot.token).toMatch(/^ar_live_/);
  });

  it("S11 task: create → assignee receives → done with result → creator notified, board updated", async () => {
    const [A, B] = await pair();
    const w = call(B, "wait_for_message", {});
    await sleep(300);
    const t = (await call(A, "create_task", { title: "Review auth.ts", description: "check it", assignee: B.name, acceptance_criteria: "no bugs", priority: "high" })).task;
    const r = await w;
    expect(r.messages[0]).toMatchObject({ type: "task", task_id: t.id });
    const wa = call(A, "wait_for_message", {});
    await sleep(300);
    await call(B, "update_task", { task_id: t.id, status: "in_progress" });
    await call(B, "update_task", { task_id: t.id, status: "done", result_summary: "LGTM, 2 nits" });
    let got = await wa;
    const all: any[] = [...got.messages];
    if (!all.some((m) => m.type === "result")) {
      got = await call(A, "wait_for_message", { timeout_seconds: 5 });
      all.push(...got.messages);
    }
    expect(all.some((m) => m.type === "result" && m.content.includes("LGTM"))).toBe(true);
    const board = (await api("GET", "tasks")).tasks.find((x: any) => x.id === t.id);
    expect(board).toMatchObject({ status: "done", result_summary: "LGTM, 2 nits", assignee: B.name });
    expect((await call(A, "list_tasks", { status: "done" })).tasks.some((x: any) => x.id === t.id)).toBe(true);
  });

  it("S12 artifact: sha256 identical (text and binary via signed URL)", async () => {
    const [A, B] = await pair();
    const text = "line\n".repeat(500) + randomBytes(8).toString("hex");
    const up = (await call(A, "upload_artifact", { name: "notes.txt", mime: "text/plain", content_text: text })).artifact;
    const got = (await call(B, "get_artifact", { artifact_id: up.id })).artifact;
    expect(got.content_text).toBe(text);
    expect(got.sha256).toBe(sha(text));
    const bin = randomBytes(3000);
    const up2 = (await call(A, "upload_artifact", { name: "b.bin", content_base64: bin.toString("base64") })).artifact;
    const g2 = (await call(B, "get_artifact", { artifact_id: up2.id })).artifact;
    expect(g2.url).toBeTruthy();
    const dl = Buffer.from(await (await fetch(g2.url.startsWith("http") ? g2.url : BASE + g2.url)).arrayBuffer());
    expect(sha(dl)).toBe(g2.sha256);
    expect(sha(dl)).toBe(sha(bin));
    const bad = await fetch(`${BASE}/api/v1/artifacts/${up2.id}/download?exp=9999999999&sig=deadbeef`);
    expect(bad.status).toBe(401);
  });

  it("S13 human request: dashboard answer lands in the agent inbox", async () => {
    const [A] = await pair();
    const req = await call(A, "request_human_input", { question: "Deploy to prod?", options: ["approve", "deny"] });
    const open = (await api("GET", "human-requests?status=open")).requests.find((r: any) => r.id === req.request_id);
    expect(open).toMatchObject({ agent: A.name, options: ["approve", "deny"] });
    const w = call(A, "wait_for_message", { timeout_seconds: 10 });
    await api("POST", `human-requests/${req.request_id}/answer`, { answer: "approve" });
    const r = await w;
    expect(r.messages[0]).toMatchObject({ content: "approve", from: { kind: "human" }, priority: "urgent", reply_to: req.message_id });
    expect((await api("GET", "human-requests?status=answered")).requests.some((x: any) => x.id === req.request_id)).toBe(true);
  });

  it("S7 human message from dashboard reaches a waiting agent; SSE streams events with resume", async () => {
    const [A, B] = await pair();
    const dm = await call(A, "send_message", { to: B.name, content: "setup dm" });
    const rid = dm.message.room_id;
    const ctrl = new AbortController();
    const res = await fetch(`${BASE}/api/v1/events`, { headers: { cookie }, signal: ctrl.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const seen: { id: string; type: string; data: any }[] = [];
    (async () => {
      const rl = createInterface({ input: Readable.fromWeb(res.body as any) });
      let cur: any = {};
      for await (const line of rl) {
        if (line.startsWith("id:")) cur.id = line.slice(3).trim();
        else if (line.startsWith("event:")) cur.type = line.slice(6).trim();
        else if (line.startsWith("data:")) cur.data = JSON.parse(line.slice(5));
        else if (line === "" && cur.type) { seen.push(cur); cur = {}; }
      }
    })().catch(() => {});
    await sleep(300);
    const w = call(A, "wait_for_message", {});
    await sleep(300);
    const t0 = Date.now();
    await api("POST", `rooms/${rid}/messages`, { content: `human says hi @${A.name}` });
    const r = await w;
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(r.messages[0]).toMatchObject({ from: { kind: "human" }, priority: "urgent" });
    await sleep(500);
    const ev = seen.find((e) => e.type === "message.created" && e.data.message?.content?.startsWith("human says hi"));
    expect(ev).toBeTruthy();
    ctrl.abort();
    // resume from Last-Event-ID: events after the id are replayed
    const res2 = await fetch(`${BASE}/api/v1/events`, { headers: { cookie, "last-event-id": String(Number(ev!.id) - 1) } });
    const reader = res2.body!.getReader();
    const chunk = new TextDecoder().decode((await reader.read()).value) + new TextDecoder().decode((await reader.read()).value);
    expect(chunk).toContain(`id: ${ev!.id}`);
    await reader.cancel();
    expect((await fetch(`${BASE}/api/v1/events`)).status).toBe(401);
  });

  it("S14 security: non-member 403, auth required, CSRF enforced, payload limits, echo/dedupe/rate-limit", async () => {
    const [A, B] = await pair();
    const C = await mkAgent();
    const room = await api("POST", "rooms", { name: `sec-${sfx}${n}`, members: [A.name, B.name] });
    const rid = room.room.id;
    expect((await call(C, "read_messages", { room_id: rid })).error.code).toBe("forbidden");
    expect((await call(C, "send_message", { room_id: rid, content: "x" })).error.code).toBe("forbidden");
    expect((await call(C, "get_room_context", { room_id: rid })).error.code).toBe("forbidden");
    expect((await api("GET", "rooms", undefined, false)).status).toBe(401);
    const noCsrf = await fetch(`${BASE}/api/v1/rooms`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "evil" }) });
    expect(noCsrf.status).toBe(403);
    expect((await api("POST", "auth/login", { email: ADMIN.email, password: "wrong-password" }, false)).status).toBe(401);
    // payload limits
    expect((await call(A, "send_message", { room_id: rid, content: "x".repeat(33 * 1024) })).error.code).toBe("payload_too_large");
    expect((await call(A, "send_message", { to: "nobody-here", content: "x" })).error.code).toBe("recipient_not_found");
    // XSS payload is stored verbatim (sanitized at render; see unit tests)
    const xss = '<img src=x onerror=alert(1)><script>alert(1)</script>';
    await call(A, "send_message", { room_id: rid, content: xss });
    expect((await api("GET", `rooms/${rid}/messages`)).messages.some((m: any) => m.content === xss)).toBe(true);
    // idempotency + echo guard
    const m1 = await call(A, "send_message", { room_id: rid, content: "once", client_message_id: "cid-1" });
    const m2 = await call(A, "send_message", { room_id: rid, content: "once", client_message_id: "cid-1" });
    expect(m2.deduplicated).toBe(true);
    expect(m2.message.id).toBe(m1.message.id);
    expect((await call(A, "send_message", { room_id: rid, content: "once" })).error.code).toBe("duplicate_message");
    // read_messages cursor pagination + search
    for (let i = 0; i < 5; i++) await call(B, "send_message", { room_id: rid, content: `needle-${sfx} #${i}` });
    const p1 = await call(A, "read_messages", { room_id: rid, limit: 3 });
    expect(p1.messages).toHaveLength(3);
    const p2 = await call(A, "read_messages", { room_id: rid, limit: 3, before_seq: p1.next_cursor });
    expect(p2.messages[p2.messages.length - 1].seq).toBeLessThan(p1.messages[0].seq);
    expect((await call(A, "search_messages", { query: `needle-${sfx}` })).messages.length).toBe(5);
    // rate limit
    await setSettings({ rateMsgPerMin: 3 });
    try {
      let err: any;
      for (let i = 0; i < 6 && !err; i++) err = (await call(B, "send_message", { room_id: rid, content: `rl ${i}` })).error;
      expect(err.code).toBe("rate_limited");
      expect(err.retry_after).toBeGreaterThan(0);
    } finally {
      await setSettings({ rateMsgPerMin: 600 });
    }
  });

  it("notify modes, thread, audit log, activity log, dead-letter, ops endpoints", async () => {
    const [A, B] = await pair();
    const room = await api("POST", "rooms", { name: `nm-${sfx}${n}`, members: [A.name, B.name] });
    const rid = room.room.id;
    await api("PATCH", `rooms/${rid}/members/${encodeURIComponent("agent:" + B.id)}`, { notify_mode: "all" });
    const w = call(B, "wait_for_message", { timeout_seconds: 3 });
    await sleep(300);
    const m = await call(A, "send_message", { room_id: rid, content: "no mention needed" });
    expect((await w).messages[0].content).toBe("no mention needed");
    await call(A, "send_message", { room_id: rid, content: "thread reply", reply_to: m.message.id });
    expect((await call(B, "read_messages", { room_id: rid, thread_id: m.message.id })).messages.length).toBe(2);
    const audit = (await api("GET", "audit-logs")).logs.map((l: any) => l.action);
    expect(audit).toEqual(expect.arrayContaining(["agent.create", "room.create", "settings.update", "token.revoke"]));
    expect((await api("GET", "activity")).activity.some((x: any) => x.agent === A.name && x.tool === "send_message")).toBe(true);
    // dead letter after >5 redeliveries
    await setSettings({ leaseSeconds: 1 });
    try {
      const [X, Y] = await pair();
      await call(X, "send_message", { to: Y.name, content: "poison" });
      for (let i = 0; i < 6; i++) {
        await call(Y, "wait_for_message", { timeout_seconds: 1 });
        await sleep(1100);
      }
      expect((await call(Y, "wait_for_message", { timeout_seconds: 1 })).status).toBe("timeout");
      const dead = (await api("GET", "inbox/dead")).items.find((i: any) => i.agent === Y.name);
      expect(dead).toBeTruthy();
      await api("POST", `inbox/${dead.id}/requeue`);
      expect((await call(Y, "wait_for_message", { timeout_seconds: 2 })).messages[0].content).toBe("poison");
    } finally {
      await setSettings({ leaseSeconds: 120 });
    }
    expect((await fetch(`${BASE}/healthz`)).status).toBe(200);
    expect((await fetch(`${BASE}/readyz`)).status).toBe(200);
    expect(await (await fetch(`${BASE}/metrics`)).text()).toContain("agentrelay_active_waits");
  });
});

// ───────── stdio shim ─────────
class Shim {
  p: ChildProcess;
  pending = new Map<number, (m: any) => void>();
  notes: any[] = [];
  id = 1;
  constructor(token: string, extra: string[] = []) {
    this.p = spawn("node", ["packages/mcp-shim/index.mjs", "--url", `${BASE}/mcp`, "--token", token, "--chunk", "2", "--progress", "1", ...extra], { stdio: ["pipe", "pipe", "inherit"] });
    children.push(this.p);
    createInterface({ input: this.p.stdout! }).on("line", (l) => {
      const m = JSON.parse(l);
      if (m.id !== undefined && this.pending.has(m.id)) this.pending.get(m.id)!(m);
      else this.notes.push(m);
    });
  }
  req(method: string, params: any) {
    const id = this.id++;
    const t0 = Date.now();
    const done = new Promise<any>((res) => this.pending.set(id, (m) => res({ ...m, ms: Date.now() - t0 })));
    this.p.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return { id, done };
  }
  note(method: string, params: any) {
    this.p.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  async init() {
    const r = await this.req("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } }).done;
    this.note("notifications/initialized", {});
    return r;
  }
}

describe("M1 shim: chunked infinite wait", () => {
  it("S17 shim keeps a no-timeout wait open across chunks, emits progress, delivers <1.5s", async () => {
    const [A, B] = await pair();
    const shim = new Shim(B.token);
    expect((await shim.init()).result.serverInfo.name).toBe("agentrelay");
    const w = shim.req("tools/call", { name: "wait_for_message", arguments: { timeout_seconds: 0 }, _meta: { progressToken: "p1" } });
    let settled = false;
    w.done.then(() => (settled = true));
    await sleep(7500); // > 3 chunks of 2s
    expect(settled).toBe(false);
    expect(shim.notes.filter((x) => x.method === "notifications/progress").length).toBeGreaterThanOrEqual(4);
    const t0 = Date.now();
    await call(A, "send_message", { to: B.name, content: "via shim" });
    const r = await w.done;
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(r.result.structuredContent.status).toBe("message");
    expect(r.result.structuredContent.messages[0].content).toBe("via shim");
    // ordinary tool through the shim
    const who = await shim.req("tools/call", { name: "whoami", arguments: {} }).done;
    expect(who.result.structuredContent.agent.name).toBe(B.name);
  }, 40_000);

  it("S20 cancel releases the wait without consuming; Wake → interrupted", async () => {
    const [A, B] = await pair();
    const shim = new Shim(B.token);
    await shim.init();
    const w = shim.req("tools/call", { name: "wait_for_message", arguments: {} });
    let settled = false;
    w.done.then(() => (settled = true));
    await sleep(1200);
    shim.note("notifications/cancelled", { requestId: w.id });
    await sleep(1200);
    expect(settled).toBe(false); // cancelled requests get no response
    await call(A, "send_message", { to: B.name, content: "after cancel" });
    await sleep(500);
    expect((await call(B, "check_inbox")).pending_count).toBe(1); // not consumed
    expect((await call(B, "wait_for_message", { timeout_seconds: 2 })).messages[0].content).toBe("after cancel");
    // wake
    const w2 = shim.req("tools/call", { name: "wait_for_message", arguments: {} });
    await sleep(800);
    await api("POST", `agents/${B.id}/wake`);
    expect((await w2.done).result.structuredContent.status).toBe("interrupted");
  }, 40_000);

  it("shim surfaces revoked token as an error instead of looping forever", async () => {
    const [, B] = await pair();
    const shim = new Shim(B.token);
    await shim.init();
    const w = shim.req("tools/call", { name: "wait_for_message", arguments: {} });
    await sleep(800);
    await api("DELETE", `agents/${B.id}/tokens/${B.tokenId}`);
    const r = await w.done;
    expect(r.error ?? r.result?.isError).toBeTruthy();
  }, 30_000);
});

describe("M5 doctor & runner", () => {
  it("S22 agentrelay doctor produces a timeout-survivability report", async () => {
    const [A] = await pair();
    const out = await new Promise<{ code: number | null; text: string }>((res) => {
      const p = spawn("node", ["packages/mcp-shim/cli.mjs", "doctor", "--url", `${BASE}/mcp`, "--token", A.token, "--durations", "2,4"]);
      let text = "";
      p.stdout.on("data", (d) => (text += d));
      p.on("close", (code) => res({ code, text }));
    });
    expect(out.code).toBe(0);
    expect(out.text).toContain("Report");
    expect(out.text).toContain("PASS");
    expect(out.text).toContain("CLIENT-side timeout");
  }, 30_000);

  it("runner executes the agent command per message, never shell-interpolates content, posts stdout reply", async () => {
    const [A, B] = await pair();
    const cfg = `/tmp/runner-${sfx}.json`;
    const pwn = `/tmp/pwned-${sfx}`;
    writeFileSync(cfg, JSON.stringify({ server: BASE, token: B.token, agent_command: `printf 'RUNNER_OK: %s' "{{prompt}}"`, post_stdout_as_reply: true, chunk_seconds: 2, timeout_minutes: 1 }));
    const p = spawn("node", ["packages/runner/index.mjs", "--config", cfg], { stdio: "ignore" });
    children.push(p);
    await sleep(1500);
    const w = call(A, "wait_for_message", { timeout_seconds: 20 });
    await call(A, "send_message", { to: B.name, content: `do it $(touch ${pwn}) \`touch ${pwn}\` "; touch ${pwn}; "` });
    const r = await w;
    expect(r.status).toBe("message");
    expect(r.messages[0].content).toContain("RUNNER_OK:");
    expect(r.messages[0].content).toContain("do it $(touch");
    expect(existsSync(pwn)).toBe(false);
    p.kill();
  }, 40_000);
});
