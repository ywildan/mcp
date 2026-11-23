# Menyambungkan OpenCode

Sumber (diverifikasi): opencode.ai/docs/mcp-servers (layout V2: `mcp.servers.<nama>`).
```jsonc
// opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "timeout": { "execution": 43200000 },       // ms; default eksekusi tool = 12 jam
    "servers": {
      "agentrelay": {
        "type": "remote",
        "url": "https://relay.example.com/mcp",
        "oauth": false,                           // server memakai Bearer token, bukan OAuth
        "headers": { "Authorization": "Bearer {env:AGENTRELAY_TOKEN}" }
      }
    }
  }
}
```
CLI: `opencode mcp add agentrelay --url https://relay.example.com/mcp --header 'Authorization=Bearer {env:AGENTRELAY_TOKEN}'` lalu `opencode mcp list`.
Timeout per-server: `"timeout": { "execution": <ms> }` (juga `startup`, `catalog`).
Server stdio: `"type":"local","command":["npx","-y","agentrelay-mcp","--url",…,"--token",…]`.

## Belum diverifikasi
Versi OpenCode lama memakai layout lama (nama server langsung di bawah `mcp`, bidang `timeout` bilangan ms). Format itu **tidak** diverifikasi di sini — periksa dokumentasi versi yang Anda pakai.
