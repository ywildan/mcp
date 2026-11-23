# AgentRelay — Deploy di raw17 (InstaBox)

Status: BERHASIL, 2026-11-21 01:45 WIB. Pindahan dari VM Muse.

## Yang jalan
- Mesin raw17, Debian 13.7 trixie, Node v22.23.3, RAM bebas 6,5 GB
- Postgres 17, cluster 17/main, port 5432, online. DB relay, user relay.
  - Start ulang: sudo pg_ctlcluster 17 main start
- Next.js 16.4.2, port 8787, PID next-server 22249 (cek ps aux | grep next-server)
  - Start ulang: cd /data/home/agentrelay && nohup npx next start -p 8787 > /data/home/agentrelay/agentrelay.log 2>&1 &
  - Log: /data/home/agentrelay/agentrelay.log
- URL lokal di raw17 (hanya dari dalam raw17):
  - http://127.0.0.1:8787/ , /api/health {"ok":true}, /api/readyz {"ready":true}, MCP /mcp

## Kredensial
- Admin: yuwiaffa@gmail.com, password sama seperti deploy VM Muse (sudah dikirim sekali di chat).
- .env di /data/home/agentrelay/.env, mode 600. JANGAN di-commit / dibagikan.
- Token agent test test-raw17 tersimpan di test-agent-token.txt (mode 600).

## Tes yang lolos di raw17
- npm install 527 packages dalam 32 detik, EXIT 0
- drizzle-kit push OK (Postgres 17)
- npm run build OK (Compiled successfully, 2,6 detik)
- Login admin 200, role admin
- MCP initialize / whoami / wait_for_message 1 detik / send_message semua 200

## Akses dari laptop
- SSH port-forward (setelah SSH ke raw17 bisa):
  ssh -p 2222 ibssh_nmtci2xhhqo62ghzkmg4fmvz24@ssh.instabox.sh -L 8787:localhost:8787
  lalu buka http://127.0.0.1:8787 di laptop.
  Catatan: ssh.instabox.sh kadang gagal resolve di WiFi iPrime, workaround IP langsung / DNS 1.1.1.1 / WARP.
- Domain mcp.helux.web.id: BELUM disetup, butuh tunnel (Cloudflare Tunnel) dari raw17.

## Catatan
- raw17 auto-pause 30 menit kalau idle, max run 480 menit. Kalau mesin pause, server mati dan perlu dibangunkan lagi, lalu start Postgres + Next.js ulang.
- Kalau raw17 dihapus, semua yang diinstall di dalamnya ikut hilang.

## Redeploy 2026-11-21 13:55 WIB (commit 7eb68207, PR #2 "Redesign landing and dashboard UI")
- Kode baru dari GitHub ywildan/agentrelay main (tarball), disinkronkan ke /data/home/agentrelay.
- Yang berubah: Landing.tsx baru, Icon.tsx, halaman /sign-in, redesign globals.css/layout/App/Chat/Agents/Pages/ui, README; core.ts hanya hapus emoji warning loop guard.
- Tidak ada perubahan package.json / .env.example / schema: npm install no-op, drizzle-kit push "No changes detected".
- .env dipertahankan, DB Postgres 17 dipertahankan (semua agent, room, dan riwayat pesan utuh).
- Backup kode lama: /data/home/agentrelay-backup-20261121-1353 (tanpa node_modules/.next).
- Build OK (route baru /sign-in), server baru PID 78806, health/readyz OK, judul baru "AgentRelay — A workspace for AI agents".
- Catatan: rsync belum ter-install di raw17, di-install dulu via apt. pkill -f "next-server" sempat membunuh sesinya sendiri (self-match) — pakai pola "[n]ext-server".

## Deploy live UI port 2026-11-21 15:23 WIB (GetShared 4JV7cWNR)
- Hasil implementasi prompt: UI agentrelay-ref di-port ke Next.js agentrelay. Backend byte-identik (core/mcp/rest/schema/API), UI baru: Landing/Docs/HowToUse/Architecture + /workspace, dep baru clsx/motion/tailwind-merge.
- .env + DB dipertahankan (semua agent/room/riwayat utuh). Backup kode lama: /data/home/agentrelay-backup-20261121-1522.
- Build OK (route baru /docs, /how-to-use, /architecture, /workspace), server PID 101011, health/readyz OK, judul baru "AgentRelay — A switchboard for your AI agents".
- Verifikasi: login admin OK, MCP initialize + whoami OK (test-raw17), muse-waiter-3678 online/waiting. Loop wait sempat kena 502 saat restart lalu lanjut sendiri (PID 12621).
- Catatan: build pertama di folder test gagal karena tanpa .env (DATABASE_URL required) — build live dengan .env berhasil. Token agent asli 51 karakter (ar_live_ + 43), mengandung -/_ jadi grep [A-Za-z0-9] memotongnya; ambil token dari file dengan cut/sed per baris.

## Routing fix 2026-11-21 16:21 WIB (landing selalu di /, workspace di /workspace)
- Masalah: / merender App yang menampilkan workspace kalau sudah login, jadi landing hilang setelah login.
- Perubahan (di repo lokal ~/workspace/agentrelay-impl lalu deploy): src/app/page.tsx kini selalu merender LandingPage (di-export dari App.tsx); App.tsx jadi workspace-only (loading screen saat boot, redirect /sign-in bila belum login di /workspace); login sukses dan kunjungan /sign-in saat sudah login mengarah ke /workspace; logout tetap ke /.
- /workspace sudah ada sebelumnya, tidak ada route baru; /dashboard tidak dibuat (sesuai pilihan user).
- Test e2e baru: signed-in tetap lihat landing di / dan workspace di /workspace. Test TIDAK dijalankan ke live (akan mengotori workspace asli) — jalankan di dev bila perlu.
- .env + DB dipertahankan. Backup: /data/home/agentrelay-backup-20261121-1620. Server baru PID 112124, health/readyz OK.
- Verifikasi: / tampil landing saat logout MAUPUN login; /workspace tampil App (loading screen, redirect client-side ke /sign-in bila belum login); login admin + /api/v1/agents OK.

## Kontras dark mode 2026-11-21 16:30 WIB (nav + judul tidak terbaca)
- Penyebab: di dark mode, teks body jadi terang (dark:text-paper) sementara permukaan terang (bg-paper/bg-paper-2) tetap terang — teks warisan jadi terang di atas latar terang.
- Perbaikan: tambah text-ink (warna tetap #14130F, tanpa varian dark) ke wadah berlatar terang: header Nav (Chrome.tsx, + tombol Sign in & menu), section The loop (Landing), section Message flow & Loop guard (Architecture), label search + 2 kartu + section REST (Docs), kartu step (HowToUse), 2 label input (ConnectTabs). 11 edit di 5 file. Tampilan light mode tidak berubah.
- Backup: /data/home/agentrelay-backup-20261121-1630. Server baru PID 114323, health/readyz OK.
- Verifikasi: browser cloud (light mode) memastikan nav, "Five calls, repeated forever.", dan 2 judul Architecture terbaca jelas. Cek dark mode langsung GAGAL: browser cloud tidak bisa emulasi prefers-color-scheme dark; Chromium headless lokal tidak bisa keluar internet (proxy egress menolak tunnel). Namun perbaikan ini aman secara konstruksi: bg dan text-ink tidak punya varian dark, jadi di dark mode tampilannya identik dengan light mode untuk elemen-elemen itu.
- Catatan: judul sempat tampak pudar sesaat saat scroll (animasi Reveal), lalu menghitam — itu animasi, bukan bug.

## Dark mode menyeluruh 2026-11-21 17:00 WIB (masih banyak teks tidak menyesuaikan)
- Penyebab: teks warna tetap (text-ink-3/text-mute/text-ink) di atas latar body yang jadi gelap di dark mode; plus pill di kotak Layer terang yang teksnya ikut body (terang di atas terang).
- Perbaikan: SectionHead kini pakai opacity (konteks-proof, 2 tempat); 46 varian dark: di semua halaman site (Landing, Architecture, Docs, HowToUse, ConnectTabs) untuk teks di atas latar body + border pemisah; kotak Layer terang diberi text-ink (pill jadi terbaca); tombol ghost di hero diberi varian dark (di CTA oranye tetap ink).
- Backup: /data/home/agentrelay-backup-20261121-1700. Server baru PID 121839, health/readyz OK.
- Verifikasi dark mode ASLI (bukan asumsi): Playwright + chromium headless shell di raw17 (/data/home/darkcheck, lawan http://127.0.0.1:8787, ar_theme=dark, colorScheme dark). Hasil: nav terbaca (screenshot), "Five calls" 14.37:1, pill 15.76:1, tombol ghost 15.76:1, semua lead/deskripsi/label paper/50-75 di atas latar gelap, semua judul section di atas latar terang 14.37:1. Screenshot: /data/home/darkcheck/dark-landing-loop.png, dark-arch.png.
- Catatan: fungsi hitung kontras di skrip pertama tidak bisa membaca warna oklab (Tailwind v4) sehingga sempat memberi verdict FAIL palsu — warna aslinya benar, diverifikasi ulang lewat nilai computed + screenshot.
