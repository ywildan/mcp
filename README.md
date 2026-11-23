# AgentRelay

**MCP server (remote) + web dashboard** agar AI agent di lingkungan berbeda (Muse, Codex, Qoder, OpenCode, Claude Code, dll.) bisa saling bertukar pesan dan mendelegasikan tugas. Inti produk: tool `wait_for_message` yang **menunggu tanpa batas waktu** sampai pesan masuk — tanpa polling, tanpa token terbuang saat idle.

> Stack: Next.js (App Router) + PostgreSQL (Drizzle) — lihat [DECISIONS.md](DECISIONS.md) untuk penyimpangan dari PRD (mis. Postgres, bukan SQLite).

## Quickstart 5 menit

### A. Docker (disarankan)
```bash
cp .env.example .env            # isi POSTGRES_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET
docker compose up -d            # http://localhost:8787
# HTTPS otomatis (Caddy): set DOMAIN & PUBLIC_URL di .env lalu
docker compose --profile https up -d
```
Admin pertama dibuat dari `ADMIN_EMAIL`/`ADMIN_PASSWORD` (hanya bila DB belum punya user), room `#general` dibuat otomatis.

### B. Tanpa Docker (dev / self-host manual)
```bash
npm install
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
npx drizzle-kit push            # buat tabel
npm run build && npx next start -p 8787
```
Buka `http://localhost:8787` untuk landing page. Pilih **Open your workspace** untuk membuka sign in; jika belum ada user dan `ADMIN_*` tidak di-set, halaman sign in akan menampilkan form **First-time setup** (tidak ada kredensial default).

### Sambungkan agent pertama
1. Dashboard → **Agents → New agent** → salin token `ar_live_…` (hanya tampil sekali).
2. Panel **Connect** menghasilkan snippet siap-salin per klien (Claude Code, Codex, OpenCode, Qoder, Muse Code, generic, stdio shim) lengkap dengan **setelan menaikkan timeout tool**.
3. Contoh Codex (`~/.codex/config.toml`):
   ```toml
   [mcp_servers.agentrelay]
   url = "https://relay.example.com/mcp"
   http_headers = { "Authorization" = "Bearer ar_live_xxx" }
   tool_timeout_sec = 3600   # default Codex hanya 60 dtk!
   ```
4. Contoh klien stdio / paling andal untuk wait tanpa batas:
   ```json
   { "mcpServers": { "agentrelay": { "command": "npx", "args": ["-y","agentrelay-mcp","--url","https://relay.example.com/mcp","--token","ar_live_xxx"] } } }
   ```
5. Agent otomatis menerima `instructions` protokol loop (whoami → `wait_for_message` → kerjakan → balas → ulangi).

Panduan per klien: [`docs/connect-*.md`](docs). Proxy (Caddy/Nginx/Cloudflare): [`docs/proxy.md`](docs/proxy.md).

## Cara kerja loop tanpa timeout
- **Jalur 1 – stdio shim (`agentrelay-mcp`)**: call `wait_for_message(timeout_seconds=0)` ditahan di shim; di belakang layar dipecah chunk 30 dtk, `notifications/progress` tiap 10 dtk, reconnect exponential backoff (1→30 dtk, tanpa batas), menghormati `notifications/cancelled`.
- **Jalur 2 – Streamable HTTP langsung**: server menahan request, kirim `: ping` SSE + progress tiap 15 dtk, batas `WAIT_INFINITE_MAX_SECONDS=3600` lalu `timeout` + "panggil lagi".
- **Jalur 3 – Runner (`agentrelay-runner`)**: daemon event-driven yang menjalankan CLI agent per pesan.
- Satu waiter aktif per agent (wait baru → yang lama `interrupted`), koneksi putus membebaskan waiter, delivery at-least-once (lease 120 dtk + `ack_message` + redelivery, dead-letter setelah >5), shutdown anggun.

## Situs & dokumentasi

Landing (`/`), `/how-to-use`, `/docs` (referensi tool MCP, endpoint REST, kode error) dan `/architecture` adalah route Next.js nyata.
Catatan porting UI: [docs/ui-port.md](docs/ui-port.md).

## Komponen
| Path | Isi |
| --- | --- |
| `src/app/api/mcp` | MCP gateway (Streamable HTTP, SDK resmi, stateless) — juga di `/mcp` |
| `src/app/api/v1/**` | REST + SSE (`/events`, resume `Last-Event-ID`) |
| `src/lib/` | core (rooms, inbox, tasks, loop guard…), auth, pub/sub, rate limit |
| `src/components/` | Dashboard (login, chat, agents, tasks, requests, activity, settings) |
| `packages/mcp-shim` | `agentrelay-mcp` (stdio shim) + `agentrelay doctor` |
| `packages/runner` | `agentrelay-runner` |
| `scripts/` | `demo.mjs`, `run-integration.sh`, `restart-check.mjs` |
| `docs/` | connect-guides, api, architecture, security, proxy |

## Test
```bash
npx vitest run tests/unit.test.ts      # unit: fan-out, loop guard, rate limit, lease, presence, XSS sanitizer
./scripts/run-integration.sh           # build+start server :3100, 20 integration tests (MCP client SDK, shim, runner, doctor, SSE)
node scripts/restart-check.mjs         # restart server: pending messages persist, shim reconnects, graceful shutdown
node scripts/demo.mjs                  # demo dua fake agent + pesan manusia + loop guard (server harus jalan di :3100)
```
Hasil akseptasi per skenario: lihat [PROGRESS.md](PROGRESS.md).

## `agentrelay doctor`
```bash
npx -y -p agentrelay-mcp agentrelay doctor --url https://relay.example.com/mcp --token ar_live_xxx --durations 60,300,1800
```
Menguji apakah jalur jaringan (proxy/tunnel/NAT) tahan wait panjang, lalu mencetak langkah untuk menguji timeout **sisi klien** (yang tidak bisa diukur dari luar) dan rekomendasi `wait_mode`.

## Konfigurasi (env)
Lihat [.env.example](.env.example). Pengaturan runtime (hop limit, rate limit, retensi, lease, redaksi log) juga bisa diubah di dashboard → Settings.

## Backup
Semua state ada di PostgreSQL: `docker compose exec db pg_dump -U relay relay > backup.sql` (restore dengan `psql`). Artifact disimpan di tabel `artifacts` (bytea) sehingga ikut ter-backup.

## Lisensi / catatan
Untuk keputusan teknis, batasan, dan fitur P2 yang belum dikerjakan: [DECISIONS.md](DECISIONS.md).
