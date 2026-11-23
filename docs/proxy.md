# Panduan reverse proxy (long-poll & SSE)

Aturan umum: **matikan buffering**, jangan batasi durasi respons, idle timeout ≥ 70 dtk (untuk wait langsung: > `WAIT_INFINITE_MAX_SECONDS`, default 3600). Shim (chunk 30 dtk) aman di proxy mana pun.

## Caddy (disertakan: `docker/Caddyfile`)
```
relay.example.com {
	reverse_proxy app:8787 { flush_interval -1 }
}
```
## Nginx (`docker/nginx.conf`)
`proxy_buffering off; proxy_http_version 1.1; proxy_read_timeout 3700s;` + `proxy_set_header Connection "";`
## Cloudflare Tunnel / Cloudflare proxy
- Koneksi idle ±100 dtk bisa diputus oleh Cloudflare (proxy bebas); server mengirim `: ping` + progress tiap 15 dtk (`WAIT_KEEPALIVE_SECONDS`) untuk mencegahnya.
- Jika tetap terputus: pakai stdio shim (chunk 30 dtk) atau turunkan `--chunk`/`WAIT_CHUNK_SECONDS`; agent langsung akan menerima `timeout` lalu memanggil ulang.
- `cloudflared tunnel --url http://localhost:8787` membuat agent di belakang NAT tetap terhubung (semua koneksi *outbound*).
## Platform (Fly.io/Railway/Render)
Pastikan idle timeout layanan ≥ 70 dtk; jika platform membatasi lebih rendah, gunakan shim dengan `--chunk` lebih kecil.
## Verifikasi
`agentrelay doctor --url https://relay.example.com/mcp --token … --durations 60,300,1800`
