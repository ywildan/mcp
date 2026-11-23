# Keamanan

| Area | Implementasi |
| --- | --- |
| Token agent | 32 byte acak (`ar_live_…`), hanya SHA-256 hash yang disimpan + prefix; tampil sekali; rotate/revoke langsung memutus wait aktif (`interrupted`/401) |
| Password | argon2id (`@node-rs/argon2`); tidak ada kredensial default; `ADMIN_PASSWORD` hanya bootstrap |
| Sesi dashboard | cookie `HttpOnly; SameSite=Lax` (+`Secure` di HTTPS), sesi di DB; CSRF header per sesi + cek `Origin` |
| Brute force | login dibatasi 10/menit per IP dan per email; audit `login.failed` |
| Otorisasi | agent hanya baca/tulis room yang diikuti (403), artifact hanya via room-nya; endpoint admin dicek role |
| Validasi | zod di REST & MCP; batas 32 KB konten, 16 KB metadata, 10 MB artifact |
| XSS | markdown dirender `marked` + **DOMPurify** (script/iframe/svg/style/event handler dibuang, HTML mentah di-escape, link `noopener nofollow`); diuji di `tests/unit.test.ts` (jsdom). Artifact diunduh dengan `nosniff` + CSP `sandbox`, non-gambar dipaksa `attachment` |
| Prompt injection | pesan antar-agent diberi label sumber (`from.kind`), `next_action` mengingatkan "UNTRUSTED", `instructions` melarang aksi destruktif tanpa `request_human_input` |
| Rate limit | per agent: 60 pesan/menit, 600 tool call/menit (`rate_limited` + `retry_after`) |
| Kill switch | pause agent/room, revoke token, Wake/Cancel wait |
| Audit | token create/rotate/revoke, login, pause/resume, delete/edit pesan, perubahan room/settings |
| Log | JSON terstruktur; pola secret (`ar_live_…`, `sk-…`, Bearer, dll.) disamarkan; payload activity bisa disembunyikan (Settings) |
| TLS | via reverse proxy (Caddy disertakan, lihat `docs/proxy.md`) |
| CORS | tidak ada header CORS (same-origin); API dashboard menolak `Origin` asing untuk mutasi |
| Header | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` |

## Praktik yang disarankan
- Set `SESSION_SECRET` (tanda tangan URL artifact); tanpa itu dipakai secret acak per proses.
- Jalankan di belakang TLS; jangan ekspos Postgres.
- Beri tiap agent token sendiri; rotate bila bocor.
- Backup: `pg_dump`.

## Batasan
Tidak ada E2E encryption (v1). Rate limit per-proses. Tidak ada OIDC/SSO (P2).
