# DECISIONS.md — keputusan, asumsi, dan penyimpangan dari PRD

| # | Keputusan | Alasan |
| - | --- | --- |
| 1 | **Next.js (App Router) + PostgreSQL/Drizzle** menggantikan Hono/Fastify + SQLite + Vite SPA. MCP, REST, SSE, dan dashboard berada di satu app Next.js. | Lingkungan builder hanya menyediakan template Next.js + Postgres. PRD §15 mengizinkan penyimpangan beralasan. Postgres memberi `FOR UPDATE SKIP LOCKED` (FR-24) langsung. |
| 2 | **Struktur repo**: bukan monorepo `apps/*`; server+dashboard di `src/`, paket di `packages/mcp-shim` & `packages/runner` (JS ESM tanpa dependensi). `packages/core` tidak dipisah; logika murni ada di `src/lib/pure.ts` (unit-tested). | Satu build Next.js; paket npm shim/runner tetap bisa dipublikasikan mandiri. Target coverage 80% `packages/core` **tidak diukur** (tidak ada tooling coverage); test fokus pada perilaku (20 integrasi + 11 unit). |
| 3 | **MCP stateless**: server baru per request POST (`sessionIdGenerator: undefined`), tanpa `Mcp-Session-Id`, GET → 405. | Sesi tak pernah kedaluwarsa selama wait aktif (Addendum B.2) dan aman untuk restart/multi-worker. Konsekuensi: **resumability `Last-Event-ID` untuk Streamable HTTP tidak diimplementasikan** — pesan aman karena lease/redelivery (item `delivered` tanpa ack dikirim ulang). SSE dashboard tetap mendukung `Last-Event-ID` penuh. |
| 4 | **Keepalive Jalur 2**: komentar SSE `: ping` disuntikkan tiap 15 dtk lewat wrapper stream + `notifications/progress` bila ada `progressToken`. | SDK tidak menulis komentar SSE sendiri. |
| 5 | **Dashboard auth bootstrap**: bila DB tanpa user dan `ADMIN_EMAIL/ADMIN_PASSWORD` tidak diset, `/` menawarkan "First run: create admin" (endpoint `auth/setup` hanya berlaku saat 0 user). | "Tidak ada kredensial default". Memudahkan `npm start` tanpa env. |
| 6 | **Password**: argon2id via `@node-rs/argon2` (m=19 MiB, t=2, p=1). Sesi: cookie `HttpOnly; SameSite=Lax` (+`Secure` jika HTTPS), sesi di DB (hash SHA-256), CSRF = token per sesi di header `x-csrf-token` + cek `Origin`. | PRD §13. |
| 7 | **Artifact disimpan di Postgres (bytea)**, bukan disk/S3. Batas 10 MB. URL unduh bertoken HMAC berumur 10 menit. | Satu-satunya volume yang perlu di-backup; S3/MinIO adalah P2 (FR-43). |
| 8 | **Humans melihat semua room** (admin/member dashboard), tidak ada pembatasan keanggotaan per-human di v1. Human otomatis jadi anggota saat mengirim pesan. | v1 single workspace; role granular = P2 (FR-6). |
| 9 | **`humans_wake_all`** default efektif `true` untuk room ≤ 3 anggota (usulan §22.1), `false` selain itu; bisa dioverride per room. | Usulan PRD. |
| 10 | **Hop counter** juga berlaku untuk DM. Pesan `human_request` dan pesan sistem (pause/resume) melewati loop guard (`skipGuards`). Pesan manusia di room yang di-pause oleh loop guard otomatis me-resume; pause manual operator hanya dibuka lewat tombol Resume. | Agar eskalasi ke manusia tidak diblokir oleh room paused. |
| 11 | **Rate limit** in-process (sliding window per agent) → tidak dibagi antar instance. Per-IP login limit 10/menit. | Single instance v1; Redis = P2. |
| 12 | **Pub/sub** = EventEmitter in-process + tabel `events` durable (replay SSE). Waiter diperiksa ulang tiap 5 dtk sebagai fallback (aman untuk multi-instance, tapi notifikasi instan hanya dalam satu proses). | PRD §15. |
| 13 | **Dead-letter**: item dengan `delivery_count ≥ 6` (lebih dari 5 redelivery) saat lease habis → `dead`; Requeue/Discard di Activity. | FR-29. |
| 14 | **Runner**: mengirim `ack_message` *sebelum* menjalankan command (at-most-once eksekusi) agar command mahal tak berjalan dobel setelah lease habis. Prompt dikirim lewat env `AGENTRELAY_PROMPT`, **tidak** diinterpolasi ke string shell (konten pesan tak tepercaya). `concurrency` selalu 1. | Keamanan & praktis. |
| 15 | **`agentrelay doctor`** menguji jalur jaringan (wait 60/300/1800 dtk langsung) dan mencetak panduan uji sisi-klien. Timeout internal klien LLM **tidak bisa diukur dari luar**; skenario akseptasi 22 dipenuhi untuk jalur jaringan, bukan klien nyata (Codex/Muse tidak tersedia di sandbox). | Batasan lingkungan; dicatat jujur. |
| 16 | **Tidak dikerjakan (P2)**: OIDC/SSO & multi-user role granular (FR-6), S3 presigned (FR-43), SLA/reassign task (FR-35), web push (FR-45 sebagian: hanya badge + suara opsional), webhook (FR-56), Redis multi-instance, E2E encryption. Redaksi pola API-key hanya di log server (bukan di payload activity; payload bisa disembunyikan lewat Settings). | Sesuai PRD. |
| 17 | **Tambahan di luar PRD** (diperlukan): `POST /auth/setup`, `agents/:id/wake`, kolom `rooms.pause_reason`, tabel `events` & `user_sessions`, `_chunk` pada `wait_for_message`, `GET /readyz`. | Mendukung fitur PRD. |
| 18 | **Alias `/mcp`, `/healthz`, `/readyz`, `/metrics`** via `rewrites` Next.js ke `/api/*`. | Sesuai PRD §9/§16. |
| 19 | **Playwright E2E**: lihat `PROGRESS.md` (status tergantung ketersediaan browser di sandbox). Skenario 7/8/9 dibuktikan di level API+SSE oleh test integrasi; XSS dibuktikan di unit test sanitizer (jsdom). | Batasan lingkungan. |
| 20 | **Docker**: tidak ada daemon Docker di sandbox, `docker compose up` **tidak dijalankan di sini**; file `Dockerfile`/compose ditulis dan jalur yang sama (build → `drizzle-kit push` → `next start`) diverifikasi manual. | Batasan lingkungan. |
| 21 | **Format konfigurasi klien** diverifikasi dari dokumentasi resmi (lihat `docs/connect-*.md`). Setelan timeout Muse Code dan IDE Qoder **belum terverifikasi** dan ditandai begitu. | Aturan "jangan menebak". |
| 22 | ESLint: aturan advisory `react-hooks/set-state-in-effect` dan `react-hooks/refs` dimatikan di `eslint.config.mjs`. | Dashboard memuat data di effect dan membaca ref textarea untuk deteksi @mention; perilaku sudah teruji E2E. |

## Batasan yang diketahui
- Klien dengan timeout tool tetap yang tidak bisa dinaikkan → gunakan `wait_mode=bounded` atau Runner.
- Provider LLM/CLI dapat membatasi durasi/jumlah langkah sesi di luar kendali server (risiko F.2 Addendum); Runner adalah jaring pengaman.
- Rate limit & notifikasi waiter bersifat per-proses (single instance).
- Unread badge di dashboard hanya in-memory (reset saat reload).
