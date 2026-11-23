#!/usr/bin/env node
// agentrelay CLI: `agentrelay doctor` — tests how long a wait_for_message call survives on the network path.
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name, env, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : (process.env[env] ?? def);
};

async function rpc(url, token, body, signal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text(); // SSE or JSON
  const data = res.headers.get("content-type")?.includes("event-stream")
    ? text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)))
    : [JSON.parse(text)];
  return data.find((m) => m.id === body.id);
}

async function doctor() {
  const url = opt("url", "AGENTRELAY_URL");
  const token = opt("token", "AGENTRELAY_TOKEN");
  const durations = opt("durations", "AGENTRELAY_DOCTOR_DURATIONS", "60,300,1800").split(",").map(Number).filter(Boolean);
  if (!url || !token) {
    console.error("Usage: agentrelay doctor --url https://relay/mcp --token ar_live_xxx [--durations 60,300,1800]");
    process.exit(2);
  }
  console.log(`AgentRelay doctor → ${url}\nTesting NETWORK path (proxy/tunnel/NAT) with a direct long wait_for_message.\n`);
  const init = await rpc(url, token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "agentrelay-doctor", version: "1.0.0" } } });
  if (!init?.result) throw new Error("initialize failed: " + JSON.stringify(init));
  console.log(`server: ${init.result.serverInfo.name} ${init.result.serverInfo.version}`);
  const results = [];
  for (const d of durations) {
    const t0 = Date.now();
    process.stdout.write(`  wait ${d}s ... `);
    try {
      const r = await rpc(url, token, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "wait_for_message", arguments: { timeout_seconds: d } } });
      const sc = r?.result?.structuredContent;
      const el = (Date.now() - t0) / 1000;
      const okRun = !!sc && (sc.status === "timeout" || sc.status === "message") && el >= Math.min(d, 1) - 0.5;
      console.log(okRun ? `PASS (status=${sc.status}, ${el.toFixed(1)}s)` : `FAIL (${JSON.stringify(sc ?? r?.error)})`);
      results.push({ d, ok: okRun });
      if (!okRun) break;
    } catch (e) {
      console.log(`FAIL (${e.message} after ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      results.push({ d, ok: false });
      break;
    }
  }
  const best = Math.max(0, ...results.filter((r) => r.ok).map((r) => r.d));
  console.log("\n── Report ──");
  console.log(`Longest network-path wait that survived: ${best}s`);
  if (results.every((r) => r.ok)) {
    console.log("Network path is OK for long waits → wait_mode=infinite is safe at the proxy level.");
  } else {
    console.log(`Connection dropped before ${results.find((r) => !r.ok).d}s → use the stdio shim (agentrelay-mcp, chunked 30s) or set wait_mode=bounded.`);
  }
  console.log(`
CLIENT-side timeout (cannot be measured from here — your agent CLI enforces it):
  Ask the agent: "Call the agentrelay tool wait_for_message with timeout_seconds=${durations[0] ?? 60} and tell me if it errors."
  Repeat with ${durations.slice(1).join(", ") || "300, 1800"}. If a client errors at N seconds:
    • raise its MCP tool timeout (see docs/connect-<client>.md), or
    • set that agent to wait_mode=bounded in the dashboard (Agents → edit), or
    • use agentrelay-runner (event-driven, no hanging tool call).
Recommendation: ${results.every((r) => r.ok) ? "wait_mode=infinite via agentrelay-mcp shim; verify client timeout as above." : "wait_mode=bounded (timeout_seconds ≤ " + Math.max(5, Math.floor(best * 0.8) || 25) + ") or Runner."}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

if (cmd === "doctor") doctor().catch((e) => { console.error("doctor failed:", e.message); process.exit(1); });
else {
  console.log("agentrelay <command>\n  doctor   test long-wait survivability: agentrelay doctor --url <mcp-url> --token <token> [--durations 60,300,1800]");
  process.exit(cmd ? 2 : 0);
}
