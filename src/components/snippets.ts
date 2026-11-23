// Connect-instruction snippets. Formats verified against each client's official docs (see docs/connect-*.md).
export interface Snippet {
  id: string;
  label: string;
  file: string;
  lang: string;
  body: string;
  timeout: string;
  verified: string;
}

export function buildSnippets(origin: string, token: string): Snippet[] {
  const url = `${origin}/mcp`;
  const T = token || "ar_live_xxx";
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      file: "terminal (or .mcp.json)",
      lang: "bash",
      body: `# Recommended for infinite wait: stdio shim (stdio has no per-request timer in Claude Code)
claude mcp add --transport stdio agentrelay -- npx -y agentrelay-mcp --url ${url} --token ${T}

# Alternative: direct remote HTTP
claude mcp add --transport http agentrelay ${url} --header "Authorization: Bearer ${T}"
`,
      timeout: `HTTP servers get a 60s per-request limit unless MCP_TOOL_TIMEOUT (ms) or a per-server timeout is set above 60000:
  MCP_TOOL_TIMEOUT=3600000 claude
Default tool timeout is ~28h; idle timeout (CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT) is 5 min for HTTP, 30 min for stdio — the shim sends progress notifications to stay alive.`,
      verified: "code.claude.com/docs (env-vars, mcp) — verified",
    },
    {
      id: "codex",
      label: "Codex CLI",
      file: "~/.codex/config.toml",
      lang: "toml",
      body: `# Direct Streamable HTTP
[mcp_servers.agentrelay]
url = "${url}"
http_headers = { "Authorization" = "Bearer ${T}" }   # or: bearer_token_env_var = "AGENTRELAY_TOKEN"
tool_timeout_sec = 3600          # default is 60s — MUST be raised for wait_for_message
startup_timeout_sec = 20

# Alternative: stdio shim (chunked wait, reconnect)
# [mcp_servers.agentrelay]
# command = "npx"
# args = ["-y", "agentrelay-mcp", "--url", "${url}", "--token", "${T}"]
# tool_timeout_sec = 3600
`,
      timeout: "Codex default tool_timeout_sec = 60. Set tool_timeout_sec = 3600 (or higher) for infinite waits; otherwise use wait_mode=bounded or the Runner.",
      verified: "developers.openai.com/codex/mcp — verified",
    },
    {
      id: "opencode",
      label: "OpenCode",
      file: "opencode.jsonc",
      lang: "json",
      body: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "timeout": { "execution": 43200000 },
    "servers": {
      "agentrelay": {
        "type": "remote",
        "url": "${url}",
        "oauth": false,
        "headers": { "Authorization": "Bearer ${T}" }
      }
    }
  }
}
// CLI: opencode mcp add agentrelay --url ${url} --header 'Authorization=Bearer ${T}'
`,
      timeout: "OpenCode execution timeout defaults to 12 hours (mcp.timeout.execution, ms). Older OpenCode versions use a different layout (servers directly under \"mcp\") — see docs/connect-opencode.md.",
      verified: "opencode.ai/docs/mcp-servers (V2 layout) — verified; legacy layout unverified",
    },
    {
      id: "qoder",
      label: "Qoder",
      file: "~/.qoder/settings.json or <project>/.mcp.json",
      lang: "json",
      body: `{
  "mcpServers": {
    "agentrelay": {
      "type": "http",
      "url": "${url}",
      "headers": { "Authorization": "Bearer ${T}" },
      "timeout": 3600000
    }
  }
}
// stdio alternative:
// "agentrelay": { "command": "npx", "args": ["-y", "agentrelay-mcp", "--url", "${url}", "--token", "${T}"] }
`,
      timeout: "Qoder CLI documents a 'timeout' field in ms for http servers. Qoder IDE (My Servers → + Add) accepts url for Streamable HTTP; its tool-timeout setting is NOT verified — prefer the stdio shim or bounded mode.",
      verified: "docs.qoder.com/cli/mcp-reference — CLI verified; IDE timeout unverified",
    },
    {
      id: "muse",
      label: "Muse Code",
      file: "~/.config/muse/settings.json",
      lang: "json",
      body: `{
  "schema_version": 1,
  "mcp_servers": {
    "agentrelay": {
      "transport": "streamable_http",
      "url": "${url}",
      "headers": { "Authorization": "Bearer \${AGENTRELAY_TOKEN}" },
      "mode": "optional"
    }
  }
}
// export AGENTRELAY_TOKEN=${T}
// stdio alternative: { "transport": "stdio", "command": "npx", "args": ["-y","agentrelay-mcp","--url","${url}","--token","${T}"] }
`,
      timeout: "Muse Code's per-tool timeout setting could NOT be verified from public docs. Run 'agentrelay doctor' and test from the agent; if waits are cut, set the agent to wait_mode=bounded or use the Runner.",
      verified: "dev.meta.ai/docs/muse-code/extending — MCP format verified; timeout unverified",
    },
    {
      id: "generic",
      label: "Generic HTTP",
      file: "mcp.json",
      lang: "json",
      body: `{
  "mcpServers": {
    "agentrelay": {
      "type": "http",
      "url": "${url}",
      "headers": { "Authorization": "Bearer ${T}" }
    }
  }
}
`,
      timeout: "Raise your client's MCP tool timeout, or use the stdio shim below.",
      verified: "MCP spec (Streamable HTTP)",
    },
    {
      id: "stdio",
      label: "stdio shim",
      file: "mcp.json (stdio-only clients)",
      lang: "json",
      body: `{
  "mcpServers": {
    "agentrelay": {
      "command": "npx",
      "args": ["-y", "agentrelay-mcp", "--url", "${url}", "--token", "${T}"]
    }
  }
}
`,
      timeout: "The shim splits wait_for_message into 30s chunks, sends progress every 10s, reconnects with backoff and honours cancellation.",
      verified: "AgentRelay",
    },
  ];
}
