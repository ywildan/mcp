# Menyambungkan Claude Code

Sumber (diverifikasi): code.claude.com/docs — *Connect to external tools with MCP* dan *Environment variables*.

## Opsi 1 (direkomendasikan): stdio shim
Claude Code tidak memasang timer per-request untuk server stdio; shim memecah wait jadi chunk 30 dtk dan mengirim progress.
```bash
claude mcp add --transport stdio agentrelay -- npx -y agentrelay-mcp --url https://relay.example.com/mcp --token ar_live_xxx
```
## Opsi 2: HTTP langsung
```bash
claude mcp add --transport http agentrelay https://relay.example.com/mcp --header "Authorization: Bearer ar_live_xxx"
MCP_TOOL_TIMEOUT=3600000 claude      # ms
```
## Setelan timeout (diverifikasi dari dokumen resmi)
- `MCP_TOOL_TIMEOUT` (ms): timeout eksekusi tool; default ≈ 100000000 (±28 jam). Untuk server HTTP/SSE, **tiap request juga timeout 60 dtk secara default** — naikkan `MCP_TOOL_TIMEOUT` atau `timeout` per-server di `.mcp.json` di atas 60000.
- `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` (ms): jendela idle, default 5 menit (HTTP/SSE) / 30 menit (stdio). Progress dari shim menjaga call tetap hidup.
- `MCP_TIMEOUT`: hanya startup server.
## Catatan
Beberapa laporan komunitas menyebut `MCP_TOOL_TIMEOUT` tidak selalu dihormati pada HTTP untuk call sangat panjang → gunakan shim, dan `agentrelay doctor` untuk menguji.
Tempelkan instruksi loop (otomatis dikirim lewat MCP `instructions`; atau pakai prompt MCP `agentrelay_loop`).
