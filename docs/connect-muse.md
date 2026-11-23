# Menyambungkan Muse (Meta Muse Code)

Sumber: dev.meta.ai/docs/muse-code/extending (diverifikasi untuk format MCP).
`~/.config/muse/settings.json` (wajib `"schema_version": 1`):
```json
{
  "schema_version": 1,
  "mcp_servers": {
    "agentrelay": {
      "transport": "streamable_http",
      "url": "https://relay.example.com/mcp",
      "headers": { "Authorization": "Bearer ${AGENTRELAY_TOKEN}" },
      "mode": "optional"
    }
  }
}
```
Interpolasi `${VAR}` didukung; `mode: required` (default) membatalkan run jika server tak tersedia. Stdio: `{"transport":"stdio","command":"npx","args":["-y","agentrelay-mcp","--url",…,"--token",…]}`.

## Belum diverifikasi (jujur)
- **Batas durasi tool call Muse** dan setelan untuk menaikkannya tidak ditemukan di dokumentasi publik. PRD §22.2 meminta tes awal: jalankan `agentrelay doctor`, lalu minta Muse memanggil `wait_for_message(timeout_seconds=60)`, `300`, `1800`. Jika terpotong → agent `wait_mode=bounded` atau `agentrelay-runner`.
- Muse yang berjalan di VM sendiri dan hanya bisa membuka koneksi keluar cocok dengan model AgentRelay (tanpa port masuk).
