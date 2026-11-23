#!/usr/bin/env node
// Demo: two fake agents talk over AgentRelay using the official MCP client SDK.
// Shows infinite wait, a human message from the "dashboard" (REST), and the loop guard.
// Usage: RELAY_URL=http://127.0.0.1:3100 ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/demo.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.RELAY_URL ?? "http://127.0.0.1:3100";
const ADMIN = { email: process.env.ADMIN_EMAIL ?? "admin@test.local", password: process.env.ADMIN_PASSWORD ?? "test-password-123" };
const sfx = Math.random().toString(36).slice(2, 6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (who, msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${who.padEnd(8)} ${msg}`);
let cookie = "", csrf = "";

async function api(method, path, body) {
  const r = await fetch(`${BASE}/api/v1/${path}`, { method, headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf }, body: body ? JSON.stringify(body) : undefined });
  return { headers: r.headers, ...(await r.json()) };
}
async function agent(name) {
  const r = await api("POST", "agents", { name, type: "custom" });
  const c = new Client({ name, version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${r.token}` } } }));
  const call = async (tool, args = {}) => (await c.callTool({ name: tool, arguments: args }, undefined, { timeout: 3_600_000 })).structuredContent;
  return { name, id: r.agent.id, call, close: () => c.close() };
}

/** The canonical agent loop from the MCP `instructions`. `think` decides the reply for each message. */
async function loop(a, think, stop) {
  while (!stop.done) {
    const r = await a.call("wait_for_message", { timeout_seconds: 0 }); // no polling: blocks until a message arrives
    if (r.status !== "message") continue;
    for (const m of r.messages) {
      await a.call("ack_message", { message_ids: [m.id] });
      await a.call("set_status", { state: "working", activity: `answering ${m.from.name}` });
      say(a.name, `⇐ ${m.from.name}: ${m.content.slice(0, 70)}`);
      const reply = think(m);
      if (reply) {
        const s = await a.call("send_message", { room_id: m.room_id, reply_to: m.id, content: reply });
        if (s.error) say(a.name, `✋ send rejected: ${s.error.code}`);
        else say(a.name, `⇒ ${reply.slice(0, 70)}${s.room_paused ? "   [room paused by loop guard]" : ""}`);
      }
    }
    await a.call("set_status", { state: "waiting" });
  }
}

const me = await api("GET", "auth/me");
const lg = me.needs_setup ? await api("POST", "auth/setup", { ...ADMIN, name: "Admin" }) : await api("POST", "auth/login", ADMIN);
cookie = lg.headers.get("set-cookie").split(";")[0];
csrf = lg.csrf;

const alice = await agent(`alice${sfx}`);
const bob = await agent(`bob${sfx}`);
const stop = { done: false };
let n = 0;
say("demo", "1) bob waits with NO timeout; alice sends him a task");
const bobLoop = loop(bob, (m) => (m.from.kind === "human" ? `Understood, human. (${++n})` : m.from.name === alice.name ? `Bob here: done with "${m.content.slice(0, 20)}"` : null), stop);
await sleep(800);
const aliceLoop = loop(alice, (m) => (m.from.kind === "human" ? `Alice acknowledging human ${++n}` : null), stop);
await alice.call("send_message", { to: bob.name, content: "Please review auth.ts" });
await sleep(1500);

say("demo", "2) a human writes in the DM from the dashboard (REST) — urgent, wakes both loops");
const dm = (await alice.call("send_message", { to: bob.name, content: "Alice → Bob: ping" })).message.room_id;
await api("POST", `rooms/${dm}/messages`, { content: `Hello from the dashboard @${bob.name}` });
await sleep(2000);

say("demo", "3) loop guard: two agents that always answer each other get stopped");
const room = (await api("POST", "rooms", { name: `loopdemo-${sfx}`, members: [alice.name, bob.name], hop_limit: 6 })).room;
bobLoop.catch(() => {});
const echo = (self, other) => (m) => (m.room_id === room.id ? `${self}: re-answering "${m.content.slice(-12)}" #${Math.random().toString(36).slice(2, 5)}` : null);
// temporary extra loops are not needed: reuse the running ones by making them reply in this room as well
const kick = alice.call("send_message", { room_id: room.id, content: `@${bob.name} let's chat`, });
await kick;
// emulate "always reply" behaviour manually (the running loops only answer humans/alice DMs)
for (let i = 0; i < 8; i++) {
  const who = i % 2 ? alice : bob;
  const r = await who.call("send_message", { room_id: room.id, content: `${who.name} keeps replying #${i}` });
  if (r.error) { say("guard", `🛑 ${who.name} rejected with ${r.error.code}`); break; }
  if (r.room_paused) say("guard", `⏸  room paused after ${r.hop.count}/${r.hop.limit} agent messages`);
}
say("demo", `   room state: ${(await api("GET", `rooms/${room.id}`)).room.state}`);
await api("POST", `rooms/${room.id}/messages`, { content: "Human here — continue, but keep it short." });
say("demo", `   after human message: ${(await api("GET", `rooms/${room.id}`)).room.state}`);
stop.done = true;
await api("POST", `agents/${alice.id}/wake`);
await api("POST", `agents/${bob.id}/wake`);
await sleep(500);
say("demo", "done ✔  (open the dashboard to see the whole conversation)");
await Promise.allSettled([aliceLoop, bobLoop]);
await alice.close();
await bob.close();
process.exit(0);
