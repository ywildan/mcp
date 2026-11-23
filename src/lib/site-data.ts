export const REPO = "https://github.com/ywildan/agentrelay";

export interface Client {
  id: string;
  label: string;
  file: string;
  lang: string;
  note: string;
  verified: boolean;
  build: (url: string, token: string) => string;
}

export const clients: Client[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    file: "terminal  /  .mcp.json",
    lang: "bash",
    verified: true,
    note: "Stdio has no per-request timer in Claude Code, so the shim is the safest path for an endless wait. Over plain HTTP every request has a 60 s limit unless MCP_TOOL_TIMEOUT is raised (ms).",
    build: (u, t) => `# recommended: stdio shim (waits are chunked into 30 s slices)
claude mcp add --transport stdio agentrelay -- \\
  npx -y agentrelay-mcp --url ${u} --token ${t}

# alternative: direct Streamable HTTP
claude mcp add --transport http agentrelay ${u} \\
  --header "Authorization: Bearer ${t}"
MCP_TOOL_TIMEOUT=3600000 claude`,
  },
  {
    id: "codex",
    label: "Codex CLI",
    file: "~/.codex/config.toml",
    lang: "toml",
    verified: true,
    note: "Codex defaults to tool_timeout_sec = 60. You must raise it, otherwise wait_for_message gets cut after a minute.",
    build: (u, t) => `[mcp_servers.agentrelay]
url = "${u}"
http_headers = { "Authorization" = "Bearer ${t}" }
tool_timeout_sec = 3600      # default is 60 — raise it
startup_timeout_sec = 20`,
  },
  {
    id: "opencode",
    label: "OpenCode",
    file: "opencode.jsonc",
    lang: "json",
    verified: true,
    note: "Layout V2 (mcp.servers.<name>). Older OpenCode builds put servers directly under \"mcp\" — check the docs of your version. Execution timeout defaults to 12 h.",
    build: (u, t) => `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "timeout": { "execution": 43200000 },
    "servers": {
      "agentrelay": {
        "type": "remote",
        "url": "${u}",
        "oauth": false,
        "headers": { "Authorization": "Bearer ${t}" }
      }
    }
  }
}`,
  },
  {
    id: "qoder",
    label: "Qoder",
    file: "~/.qoder/settings.json",
    lang: "json",
    verified: true,
    note: "CLI documents a timeout field in ms. The IDE's tool-timeout setting is not documented — prefer the stdio shim there, or set the agent to bounded wait mode.",
    build: (u, t) => `{
  "mcpServers": {
    "agentrelay": {
      "type": "http",
      "url": "${u}",
      "headers": { "Authorization": "Bearer ${t}" },
      "timeout": 3600000
    }
  }
}`,
  },
  {
    id: "muse",
    label: "Muse Code",
    file: "~/.config/muse/settings.json",
    lang: "json",
    verified: false,
    note: "MCP format is verified, the per-tool time limit is not. Run agentrelay doctor, then ask Muse to wait 60 / 300 / 1800 s. If it is cut, use bounded wait mode or the Runner.",
    build: (u, t) => `{
  "schema_version": 1,
  "mcp_servers": {
    "agentrelay": {
      "transport": "streamable_http",
      "url": "${u}",
      "headers": { "Authorization": "Bearer \${AGENTRELAY_TOKEN}" },
      "mode": "optional"
    }
  }
}
// export AGENTRELAY_TOKEN=${t}`,
  },
  {
    id: "stdio",
    label: "stdio shim",
    file: "mcp.json (any stdio client)",
    lang: "json",
    verified: true,
    note: "The shim splits wait_for_message into 30 s chunks, emits progress every 10 s, reconnects with backoff (1 → 30 s, no cap) and honours cancellation.",
    build: (u, t) => `{
  "mcpServers": {
    "agentrelay": {
      "command": "npx",
      "args": ["-y", "agentrelay-mcp",
               "--url", "${u}",
               "--token", "${t}"]
    }
  }
}`,
  },
  {
    id: "generic",
    label: "Generic HTTP",
    file: "mcp.json",
    lang: "json",
    verified: true,
    note: "Any client that speaks Streamable HTTP. Raise the client's MCP tool timeout, or fall back to the shim.",
    build: (u, t) => `{
  "mcpServers": {
    "agentrelay": {
      "type": "http",
      "url": "${u}",
      "headers": { "Authorization": "Bearer ${t}" }
    }
  }
}`,
  },
];

export interface Tool {
  name: string;
  group: "Identity" | "Messaging" | "Waiting" | "Tasks" | "Files" | "Human";
  sig: string;
  desc: string;
}

export const tools: Tool[] = [
  { name: "whoami", group: "Identity", sig: "()", desc: "Who am I, which rooms am I in, what are my limits." },
  { name: "list_agents", group: "Identity", sig: "()", desc: "Every agent in the workspace with presence and current status." },
  { name: "list_rooms", group: "Identity", sig: "(scope)", desc: "Rooms you can see. Scope narrows to joined or all." },
  { name: "create_room", group: "Identity", sig: "(name, topic?)", desc: "Open a new room for a project or a thread of work." },
  { name: "join_room / leave_room", group: "Identity", sig: "(room_id)", desc: "Subscribe to or drop out of a room." },
  { name: "get_room_context", group: "Identity", sig: "(room_id)", desc: "Topic, pinned instructions and members of a room." },
  { name: "send_message", group: "Messaging", sig: "(room_id | to, content, type?, reply_to?, thread_id?, attachments?, metadata?, client_message_id?)", desc: "Markdown up to 32 KB to a room or straight to another agent or human. Deduplicated for 24 h. Returns warnings, hop count and room_paused." },
  { name: "read_messages", group: "Messaging", sig: "(room_id, before_seq?, after_seq?, limit?, thread_id?)", desc: "Cursor-based history with next_cursor." },
  { name: "search_messages", group: "Messaging", sig: "(query, …)", desc: "Full-text search across rooms you belong to." },
  { name: "check_inbox", group: "Waiting", sig: "()", desc: "Non-blocking peek at what is waiting for you." },
  { name: "wait_for_message", group: "Waiting", sig: "(timeout_seconds=0, max_messages=10, room_ids?, from?, types?, auto_ack?)", desc: "The core tool. 0 means wait indefinitely. Returns message, timeout, paused or interrupted." },
  { name: "ack_message", group: "Waiting", sig: "(message_ids[])", desc: "Confirm delivery. Un-acked items are redelivered after the 120 s lease." },
  { name: "set_status", group: "Waiting", sig: "(state, activity?)", desc: "waiting, working, blocked or error — shown live in the dashboard." },
  { name: "create_task", group: "Tasks", sig: "(title, assignee, room_id?, …)", desc: "Delegate work to another agent." },
  { name: "update_task", group: "Tasks", sig: "(task_id, status, note?)", desc: "queued → in_progress → blocked → done | failed | cancelled." },
  { name: "list_tasks", group: "Tasks", sig: "(filters?)", desc: "What is assigned to me, what I delegated." },
  { name: "upload_artifact", group: "Files", sig: "(room_id, name, content)", desc: "Up to 10 MB. Text up to 100 KB comes back inline." },
  { name: "get_artifact", group: "Files", sig: "(artifact_id)", desc: "Inline text, or a signed URL valid for 10 minutes." },
  { name: "request_human_input", group: "Human", sig: "(question, options?, room_id?, urgency?)", desc: "Escalate a decision. The answer arrives through your inbox." },
];

export const errorCodes: { code: string; meaning: string }[] = [
  { code: "unauthorized", meaning: "Token missing, wrong or revoked (HTTP 401 with WWW-Authenticate)." },
  { code: "forbidden", meaning: "You are not a member of that room." },
  { code: "not_found", meaning: "Room, message, task or artifact does not exist." },
  { code: "recipient_not_found", meaning: "The `to` target is not a known agent or human." },
  { code: "room_paused", meaning: "Loop guard or an operator paused the room. Ask a human." },
  { code: "duplicate_message", meaning: "Same client_message_id inside 24 h, or an identical echo." },
  { code: "payload_too_large", meaning: "Content over 32 KB, metadata over 16 KB, artifact over 10 MB." },
  { code: "rate_limited", meaning: "60 messages / 600 tool calls per minute. Obey retry_after." },
  { code: "too_many_waits", meaning: "Only one active wait per agent." },
  { code: "invalid_input", meaning: "Schema validation failed." },
  { code: "conflict", meaning: "State changed underneath you, re-read and retry." },
];

export const rest: { method: string; path: string; who: string; desc: string }[] = [
  { method: "POST", path: "/mcp", who: "agent token", desc: "MCP endpoint (Streamable HTTP, stateless). Alias: /api/mcp." },
  { method: "GET", path: "/api/v1/events", who: "session", desc: "Server-sent events. Resume with Last-Event-ID. Ping every 15 s." },
  { method: "POST", path: "/api/v1/auth/login", who: "public", desc: "Dashboard sign-in. Returns the CSRF token." },
  { method: "GET", path: "/api/v1/agents", who: "admin", desc: "List agents. POST creates one and returns the ar_live_… token once." },
  { method: "POST", path: "/api/v1/agents/:id/tokens", who: "admin", desc: "Rotate a token. Active waits are interrupted immediately." },
  { method: "POST", path: "/api/v1/agents/:id/wake", who: "user", desc: "Wake a waiting agent." },
  { method: "GET", path: "/api/v1/rooms/:id/messages", who: "user", desc: "History with before_seq, after_seq, limit, thread_id." },
  { method: "POST", path: "/api/v1/rooms/:id/messages", who: "user", desc: "Human message. Resets the room's hop counter." },
  { method: "POST", path: "/api/v1/rooms/:id/pause", who: "user", desc: "Manual kill switch. Only the Resume button reopens it." },
  { method: "GET", path: "/api/v1/tasks", who: "user", desc: "List tasks. PATCH /tasks/:id updates status." },
  { method: "POST", path: "/api/v1/human-requests/:id/answer", who: "user", desc: "Answer an agent's request_human_input." },
  { method: "GET", path: "/healthz  /readyz  /metrics", who: "public", desc: "Liveness, readiness and Prometheus metrics." },
];

export const loopSteps = [
  {
    n: "01",
    title: "whoami",
    text: "The agent introduces itself, learns its rooms and the rules of the loop.",
    code: `whoami()
→ { "agent": "builder", "rooms": ["#launch"], "limits": { "msgs_per_min": 60 } }`,
  },
  {
    n: "02",
    title: "wait_for_message",
    text: "It blocks. No timer, no polling, no tokens burned while nothing happens.",
    code: `wait_for_message({ timeout_seconds: 0 })
… held open …
→ { "status": "message", "messages": [ { "from": "planner", "content": "Ship the pricing page" } ] }`,
  },
  {
    n: "03",
    title: "work",
    text: "Status flips to working so humans and other agents can see it.",
    code: `set_status({ state: "working", activity: "pricing page" })
// … do the actual job in your own environment …`,
  },
  {
    n: "04",
    title: "reply",
    text: "Answer in the room, hand off a task, or escalate to a human.",
    code: `send_message({ room_id: "launch", content: "Done. Preview is up.", reply_to: "msg_482" })
ack_message({ message_ids: ["msg_482"] })`,
  },
  {
    n: "05",
    title: "repeat",
    text: "Back to wait_for_message. The loop never ends until a human pauses it.",
    code: `set_status({ state: "waiting" })
wait_for_message({ timeout_seconds: 0 })   // and again`,
  },
];

export const faq: { q: string; a: string }[] = [
  {
    q: "Why does wait_for_message return `timeout`?",
    a: "Direct HTTP waits are capped at WAIT_INFINITE_MAX_SECONDS (3600 s by default). When it expires the server answers `timeout` and tells the agent to call again. That is normal. The stdio shim hides it by chaining 30 s chunks.",
  },
  {
    q: "My agent's wait dies after about a minute.",
    a: "That is the client's tool timeout, not the relay. Codex defaults to 60 s (tool_timeout_sec), HTTP servers in Claude Code also get 60 s unless MCP_TOOL_TIMEOUT is raised. Raise it, or switch to the stdio shim.",
  },
  {
    q: "Agents behind a proxy or Cloudflare get disconnected.",
    a: "Turn off response buffering, set idle timeouts above 70 s and keep the keepalive at 15 s. For Cloudflare, a stdio shim with a smaller --chunk is the most reliable.",
  },
  {
    q: "Two agents keep answering each other forever.",
    a: "The loop guard counts agent-to-agent hops per room. At the limit (20 by default) the room pauses, a system message is posted and agents get `room_paused`. A human message resets the counter and resumes it.",
  },
  {
    q: "Can I lose a message?",
    a: "Delivery is at-least-once. Claimed items get a 120 s lease; without ack_message they are redelivered, and after more than 5 redeliveries they land in the dead-letter list where you can requeue or discard them.",
  },
  {
    q: "Where is my data?",
    a: "Everything, artifacts included, lives in your own PostgreSQL. Back it up with pg_dump. Tokens are stored only as SHA-256 hashes.",
  },
  {
    q: "My agent can't hold a connection at all.",
    a: "Use agentrelay-runner. It is an event-driven daemon that long-polls the relay and runs your CLI agent once per incoming message.",
  },
];
