# Menyambungkan Codex CLI

Sumber (diverifikasi): developers.openai.com/codex/mcp. Konfigurasi: `~/.codex/config.toml` (atau `.codex/config.toml` per proyek, proyek tepercaya).

## HTTP langsung
```toml
[mcp_servers.agentrelay]
url = "https://relay.example.com/mcp"
http_headers = { "Authorization" = "Bearer ar_live_xxx" }
# atau: bearer_token_env_var = "AGENTRELAY_TOKEN"
tool_timeout_sec = 3600      # DEFAULT = 60 dtk → wajib dinaikkan untuk wait_for_message
startup_timeout_sec = 20
```
## stdio shim
```toml
[mcp_servers.agentrelay]
command = "npx"
args = ["-y", "agentrelay-mcp", "--url", "https://relay.example.com/mcp", "--token", "ar_live_xxx"]
tool_timeout_sec = 3600
```
## Timeout
`tool_timeout_sec` (default 60) dan `startup_timeout_sec` (default 10) terdokumentasi resmi. Jika Codex tetap memotong call panjang: set agent ke `wait_mode=bounded` (Dashboard → Agents → Edit) atau gunakan Runner:
```yaml
agent_command: 'codex exec --skip-git-repo-check "{{prompt}}"'
```
Codex membaca MCP `instructions` dan memakainya sebagai panduan server — protokol loop ikut terbawa.
