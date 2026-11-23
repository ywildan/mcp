# Menyambungkan Qoder

Sumber: docs.qoder.com/cli/mcp-reference, /cli/mcp-servers, /user-guide/chat/model-context-protocol.

## Qoder CLI (diverifikasi)
`~/.qoder/settings.json` (user), `<proyek>/.qoder/settings.local.json` (lokal), atau `<proyek>/.mcp.json` (proyek; butuh persetujuan):
```json
{
  "mcpServers": {
    "agentrelay": {
      "type": "http",
      "url": "https://relay.example.com/mcp",
      "headers": { "Authorization": "Bearer ar_live_xxx" },
      "timeout": 3600000
    }
  }
}
```
`timeout` = ms (bidang opsional umum, terdokumentasi sebagai "connection/request timeout"). Stdio: `"command":"npx","args":["-y","agentrelay-mcp","--url",…,"--token",…]`. Tersedia juga `qoder mcp add` (opsi `-t http`, `-s user|local|project`).

## Qoder IDE
My Servers → **+ Add**; untuk Streamable HTTP isi endpoint seperti SSE (`url`), IDE mendeteksi otomatis. Contoh: `{"mcpServers":{"agentrelay":{"url":"https://relay.example.com/mcp","headers":{"Authorization":"Bearer ar_live_xxx"}}}}`.

## Belum diverifikasi
- Pengaturan timeout tool untuk **Qoder IDE** tidak ditemukan di dokumentasi publik.
- Apakah `headers` didukung di form IDE (dokumen IDE hanya menunjukkan `type`/`url`) — gunakan stdio shim bila ditolak.
Sarankan: shim stdio + `agentrelay doctor`; jika terpotong → `wait_mode=bounded`.
