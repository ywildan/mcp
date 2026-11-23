# Arsitektur

```
Agent (Claude Code/Codex/…) ──stdio──▶ agentrelay-mcp (shim) ──HTTPS chunk 30s──┐
Agent langsung ──Streamable HTTP (keepalive 15s)───────────────────────────────┤
agentrelay-runner (long-poll chunk, jalankan CLI) ─────────────────────────────┤
                                                                               ▼
                            Next.js:  /mcp  (MCP SDK, stateless)   /api/v1/*  (REST)   /api/v1/events (SSE)
                                         └────────── src/lib/core.ts · inbox.ts · pure.ts ──────────┘
                                                              │
                                                      PostgreSQL (Drizzle)
Browser dashboard ◀── SSE + REST ─────────────────────────────┘
```

## Aliran pesan
1. `sendMessage` (satu transaksi): kunci baris room (`FOR UPDATE`) → `seq = last_seq+1` → insert pesan/mentions/attachments → hop counter → fan-out ke `inbox_items` (aturan PRD §11, `pure.ts#computeRecipients`).
2. Setelah commit: event `message.created` disimpan di tabel `events` + dipancarkan ke SSE; `notifyAgent` membangunkan waiter agent penerima di proses yang sama.
3. `wait_for_message`: registry waiter (satu per agent, `globalThis`) → klaim atomik `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` menandai `delivered` + lease → loop tidur (dibangunkan oleh notify/abort/interrupt, fallback 5 dtk, keepalive 15 dtk yang memperbarui `last_seen_at`).
4. Respons berhasil → agent `ack_message`. Tanpa ack sampai lease habis → klaim berikutnya mengembalikan item dengan `redelivered:true`; `delivery_count ≥ 6` → `dead`.

## Menjaga wait tetap andal
- **Koneksi mati**: stream wrapper di `/api/mcp` membatalkan `AbortController` saat client putus; loop melepas item yang sudah diklaim (`releaseItems`) bila sinyal abort/interrupt terjadi setelah klaim.
- **Wait ganda**: wait baru memanggil `interrupt("replaced")` pada yang lama.
- **Pause/revoke/wake**: mengubah state lalu `notifyAgent`/`interruptWaiter`; loop mengecek state agent tiap iterasi.
- **Shutdown anggun**: SIGTERM → semua waiter selesai dengan `timeout` + "panggil lagi".
- **Presence**: `online` jika ada waiter atau `last_seen_at` < 60 dtk; `idle` < 10 mnt; selain itu `offline`.

## Loop guard
`rooms.hop_count` +1 per pesan agent, reset oleh pesan manusia. `>= hop_limit` → room `paused` (`pause_reason=loop_guard`), pesan sistem, event `room.paused`; pesan agent ditolak `room_paused`. Peringatan 80% disisipkan di `next_action`. Echo guard menolak pesan identik beruntun.

## Model data
Lihat `src/db/schema.ts` (mengikuti PRD §10 + `user_sessions`, `events`, kolom tambahan).
