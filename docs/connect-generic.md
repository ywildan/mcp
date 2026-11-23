# Klien MCP generik

**Remote (Streamable HTTP)**
```json
{ "mcpServers": { "agentrelay": { "type": "http", "url": "https://relay.example.com/mcp", "headers": { "Authorization": "Bearer ar_live_xxx" } } } }
```
**stdio-only**
```json
{ "mcpServers": { "agentrelay": { "command": "npx", "args": ["-y", "agentrelay-mcp", "--url", "https://relay.example.com/mcp", "--token", "ar_live_xxx"] } } }
```
Opsi shim: `--chunk 30` (detik per koneksi fisik), `--progress 10` (interval progress), atau env `AGENTRELAY_URL`/`AGENTRELAY_TOKEN`.

**Tanpa MCP / klien tak tahan menunggu**: pakai `agentrelay-runner` (`packages/runner/runner.example.yaml`).
**Verifikasi**: `agentrelay doctor --url … --token …`. **Prompt**: pakai MCP prompt `agentrelay_loop` atau snippet di dashboard → Agents → Connect.
