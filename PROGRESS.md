# PROGRESS.md

Rencana: M0 fondasi → M1 messaging+wait loop (dibuktikan test sebelum dashboard) → M2 dashboard → M3 safety → M4 kolaborasi → M5 runner/doctor/docs/docker. Semua milestone dikerjakan; keputusan di [DECISIONS.md](DECISIONS.md).

## Milestone
- ✅ M0 Fondasi (skema Drizzle, token agent hash, health/readyz/metrics)
- ✅ M1 Messaging inti + infinite wait (shim chunk/progress/reconnect/cancel, keepalive, single waiter, lease/ack)
- ✅ M2 Dashboard (login/setup, chat SSE, @mention, Agents + connect snippets)
- ✅ M3 Safety (loop guard, rate limit, pause/resume, audit, dead-letter)
- ✅ M4 Kolaborasi (task+board, artifact, human request, thread, notify modes, search)
- ✅ M5 Runner, doctor, metrik, docs, Docker/compose, demo (⚠ `docker compose up` tidak bisa dijalankan di sandbox — tanpa daemon Docker)

## Skenario akseptasi (PRD §19 + Addendum §D)
| # | Skenario | Status | Bukti |
| - | --- | --- | --- |
| 1 | Koneksi & whoami | ✅ | `integration` S1 |
| 2 | Loop dasar <1 s | ✅ | S2 (+ demo) |
| 3 | Timeout ±1 s + next_action | ✅ | S3 |
| 4 | Offline delivery | ✅ | S4 |
| 5 | At-least-once (redelivered, ack) | ✅ | S5 |
| 6 | Tanpa double-deliver | ✅ | S6/S21 |
| 7 | Dashboard real-time (SSE + pesan manusia → agent) | ✅ | `integration` S7 (SSE+Last-Event-ID) + Playwright S7 |
| 8 | Mention (mentions_only) | ✅ | `integration` S8 + Playwright S7/S8 |
| 9 | Loop guard + banner + Resume/pesan manusia | ✅ | `integration` S9 + Playwright S9 |
| 10 | Kill switch (paused, revoke→401) | ✅ | S10/S20 + Playwright |
| 11 | Task end-to-end + board | ✅ | S11 + Playwright |
| 12 | Artifact sha256 identik | ✅ | S12 (teks & biner via URL bertoken) |
| 13 | Human request | ✅ | S13 + Playwright |
| 14 | Keamanan (403, XSS) | ✅ | S14 + unit XSS (jsdom) + Playwright XSS inert |
| 15 | Ketahanan restart | ✅ | `scripts/restart-check.mjs` |
| 16 | `docker compose up` | ⚠ file ditulis, tidak dieksekusi (tak ada Docker); jalur build→push→start diverifikasi manual | README, `Dockerfile`, `docker-compose.yml` |
| 17 | Wait panjang via shim | ✅ (versi dipersingkat: chunk 2 dtk × >3 siklus, 7,5 dtk; bukan 30 menit) | shim S17; mekanisme chunk identik |
| 18 | Lewat Caddy/Nginx | ❌ tidak diuji (tak ada Caddy/Nginx/Docker di sandbox); konfigurasi disertakan | `docs/proxy.md` |
| 19 | Restart server saat wait aktif | ✅ | `restart-check` (shim reconnect, tanpa error ke agent; direct wait → `timeout`) |
| 20 | Cancel & Wake | ✅ | shim S20 (cancel tak mengonsumsi) + Wake → `interrupted` |
| 21 | Single waiter | ✅ | S6/S21 |
| 22 | Doctor | ✅ jalur jaringan; ⚠ klien nyata (Codex/Muse) tidak tersedia di sandbox | S22 |

## Tes
- Unit: `tests/unit.test.ts` (11) · Integrasi: `tests/integration.test.ts` (20, termasuk shim, runner, doctor, SSE) · E2E Playwright: `tests/e2e/dashboard.spec.ts` (4) · Restart: `scripts/restart-check.mjs` · Demo: `scripts/demo.mjs`.

## FR
P0 ✅ semua (FR-1…5, 7…10, 13…17, 21…26, 22a-d/f, 36…38, 44, 47…49, 52, 53). P1 ✅: FR-11, 12, 18, 19, 20, 22e, 22g, 27…29, 30…34, 39 (heartbeat via keepalive `last_seen_at`), 40…42, 45, 46, 50, 51, 54, 55, runner, prompts/resources. P2 ❌ belum: FR-6 (OIDC), 35, 43, 56, Redis, web push, multi-workspace UI.

## Langkah berikutnya (opsional)
Uji klien nyata (Codex, Muse) dengan `agentrelay doctor`; verifikasi setelan timeout Muse/Qoder IDE; jalankan `docker compose up` di host dengan Docker; load test (k6/autocannon) belum dibuat.
