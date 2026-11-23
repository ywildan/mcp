#!/usr/bin/env node
// agentrelay-runner — event-driven daemon (Mode B): long-polls the inbox and runs a CLI agent per message.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

function parseYaml(src) {
  const cfg = {};
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][\w]*):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const [, k, v0] = m;
    let v = v0.replace(/\s+#.*$/, "").trim();
    if (v === "|" || v === ">") {
      const block = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === "")) block.push(lines[++i].replace(/^ {1,2}/, ""));
      cfg[k] = block.join("\n").replace(/\n+$/, "\n");
      continue;
    }
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
    cfg[k] = v === "true" ? true : v === "false" ? false : /^\d+$/.test(v) ? Number(v) : v;
  }
  return cfg;
}

const argv = process.argv.slice(2);
const ci = argv.indexOf("--config");
if (ci < 0 || !argv[ci + 1]) {
  console.error("Usage: agentrelay-runner --config runner.yaml");
  process.exit(2);
}
const raw = readFileSync(argv[ci + 1], "utf8");
const cfg = argv[ci + 1].endsWith(".json") ? JSON.parse(raw) : parseYaml(raw);
for (const k of ["server", "token", "agent_command"]) if (!cfg[k]) throw new Error(`runner config missing '${k}'`);
const MCP = cfg.server.replace(/\/$/, "").replace(/\/mcp$/, "") + "/mcp";
const TIMEOUT_MS = (cfg.timeout_minutes ?? 30) * 60_000;
const CHUNK = cfg.chunk_seconds ?? 30;
const TEMPLATE =
  cfg.prompt_template ??
  "You received a message via AgentRelay from {{from}} in #{{room}}:\n---\n{{content}}\n---\nDo the work. Reply using the agentrelay MCP tools (send_message with reply_to={{message_id}}).";
const log = (m) => console.log(JSON.stringify({ ts: new Date().toISOString(), runner: m }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let rid = 1;
let stopping = false;
const ctrl = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopping = true; ctrl.abort(); setTimeout(() => process.exit(0), 300); });

async function call(name, args) {
  const body = { jsonrpc: "2.0", id: rid++, method: "tools/call", params: { name, arguments: args } };
  const res = await fetch(MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error("unauthorized"), { fatal: true });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const msgs = (res.headers.get("content-type") ?? "").includes("event-stream")
    ? text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)))
    : [JSON.parse(text)];
  const m = msgs.find((x) => x.id === body.id);
  if (!m || m.error) throw new Error(JSON.stringify(m?.error ?? "no response"));
  return m.result.structuredContent;
}

const render = (tpl, v) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] ?? "");

function runCommand(prompt) {
  // The prompt is passed via env var, never interpolated into the shell string (message content is untrusted).
  const cmd = cfg.agent_command.replace(/["']?\{\{prompt\}\}["']?/g, '"$AGENTRELAY_PROMPT"');
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", cmd], { cwd: cfg.working_dir || process.cwd(), env: { ...process.env, AGENTRELAY_PROMPT: prompt } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => { err += "\n[runner] timeout, killing"; child.kill("SIGKILL"); }, TIMEOUT_MS);
    child.on("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
    child.on("error", (e) => { clearTimeout(t); resolve({ code: -1, out, err: String(e) }); });
  });
}

async function handle(me, m) {
  await call("ack_message", { message_ids: [m.id] }); // ack first: avoid duplicate expensive runs after lease expiry
  await call("set_status", { state: "working", activity: `runner: ${m.content.slice(0, 60)}` });
  const prompt = render(TEMPLATE, { from: m.from.name, room: m.room_name, room_id: m.room_id, content: m.content, message_id: m.id });
  log(`running agent for message ${m.id} from ${m.from.name}`);
  const r = await runCommand(prompt);
  log(`agent finished code=${r.code}`);
  let replied = false;
  try {
    const hist = await call("read_messages", { room_id: m.room_id, after_seq: m.seq, limit: 50 });
    replied = hist.messages.some((x) => x.from.name === me && x.reply_to === m.id);
  } catch {}
  if (!replied && (cfg.post_stdout_as_reply || r.code !== 0)) {
    const text = r.code === 0 ? r.out.trim() : `Runner: agent command failed (exit ${r.code}).\n${(r.err || r.out).trim().slice(-1500)}`;
    if (text) await call("send_message", { room_id: m.room_id, reply_to: m.id, content: text.slice(0, 30000) });
  }
  await call("set_status", { state: "waiting", activity: "" });
}

(async () => {
  const me = (await call("whoami", {})).agent.name;
  log(`connected as ${me} → ${MCP}`);
  let backoff = 1000;
  while (!stopping) {
    try {
      const res = await call("wait_for_message", { timeout_seconds: CHUNK, max_messages: 1, _chunk: true });
      backoff = 1000;
      if (res.status === "paused") { await sleep(30_000); continue; }
      for (const m of res.messages ?? []) await handle(me, m);
    } catch (e) {
      if (stopping) break;
      if (e.fatal) { log("token rejected — exiting"); process.exit(1); }
      log(`error: ${e.message}; retry in ${backoff / 1000}s`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 30_000);
    }
  }
})();
