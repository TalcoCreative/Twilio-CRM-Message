# Pindah Semua ke VPS Sendiri (Postgres) — Peta Infrastruktur & Rencana Migrasi

## 1. Infrastruktur yang dipakai sekarang

| Lapisan | Teknologi | Fungsi di CRM Husada |
|---|---|---|
| Frontend + SSR | TanStack Start (React 19, Vite), jalan di edge runtime Lovable | Semua halaman: /inbox, /leads, /dashboard, /settings, /ads-content |
| API internal | TanStack server routes (`src/routes/api/*`) | Backfill Twilio, endpoint publik |
| Database | Postgres terkelola (Supabase) | 20 tabel: contacts, conversations, messages, audit_events, dll |
| Data API | PostgREST + RLS | Semua query dari browser lewat `supabase-js`, keamanan per-role (super_admin/admin/agent/first_response) |
| Auth | GoTrue (Supabase Auth) | Login agent, session, `handle_new_user` trigger |
| Realtime | Realtime server (WAL → websocket) | Chat inbox live, invitation, dashboard |
| Storage | Bucket `chat-media` | Foto/video/voice/PDF dari & ke WhatsApp |
| Fungsi backend | Edge Functions (Deno): twilio-webhook, twilio-send, twilio-status, twilio-followup, manage-agent, dll | Kirim/terima WhatsApp, template, notifikasi agent |
| WhatsApp | Twilio Programmable Messaging (tetap eksternal, tetap berbayar Twilio) | Inbound webhook + outbound + status callback |

Ukuran data saat ini kecil: **total DB 65 MB** (messages 15.527 baris / 6,5 MB; gateway logs 25 MB; audit_events 13 MB). Jadi migrasi ringan — bottleneck-nya bukan data, tapi jumlah service yang harus ikut pindah.

## 2. Poin penting sebelum pilih arah

"Pakai Postgres saja" tidak cukup: aplikasi ini juga bergantung pada Auth, Realtime, Storage, dan RLS/PostgREST. Kalau hanya menyalakan Postgres polos di VPS, empat lapisan itu harus ditulis ulang dari nol (login, upload media, live chat, aturan akses) — itu pekerjaan besar dan berisiko.

Ada dua jalur:

**Jalur A — Self-host Supabase di VPS (rekomendasi).**
Satu `docker compose` di VPS berisi Postgres + PostgREST + GoTrue + Realtime + Storage + Kong. Semua kode aplikasi tetap sama; yang berubah hanya URL dan API key di environment. Semua RLS policy, trigger, dan fungsi database ikut apa adanya. Edge Functions Deno bisa dijalankan lewat container `edge-runtime`, atau (lebih rapi) dipindah jadi TanStack server routes di app yang sama.

**Jalur B — Postgres murni + backend custom.**
Hemat resource sedikit, tapi butuh menulis ulang autentikasi (JWT + hashing), akses data (semua query browser jadi server function), realtime (websocket sendiri), upload file (disk/S3), dan menerjemahkan seluruh RLS jadi pengecekan di kode. Perkiraan pekerjaan berkali-kali lipat Jalur A, dan setiap fitur harus diuji ulang.

## 3. Rencana migrasi (Jalur A)

1. **Siapkan VPS.** Ubuntu, Docker + Compose, domain (mis. `db.crm.webhaus.id`), Caddy/Nginx untuk TLS otomatis. Firewall: hanya 80/443 terbuka, port Postgres tertutup dari publik.
2. **Deploy stack Supabase self-host.** Set JWT secret, anon/service key, SMTP untuk email auth, dan volume terpisah untuk data Postgres + storage.
3. **Pindahkan skema & data.** Dump `public` + `auth` dari database sekarang, restore ke VPS, lalu verifikasi jumlah baris per tabel, enum, trigger, dan semua RLS policy. User dan password agent ikut pindah lewat schema `auth` (tidak perlu reset password).
4. **Pindahkan file media.** Sinkronkan isi bucket `chat-media` ke storage VPS, cek beberapa URL lama di inbox masih tampil.
5. **Pindahkan fungsi Twilio.** Jalankan edge-runtime di VPS, atau konversi `twilio-webhook`, `twilio-send`, `twilio-status`, `twilio-followup`, `manage-agent` menjadi route `src/routes/api/public/*` di aplikasi. Semua secret Twilio dipindah ke env VPS.
6. **Deploy aplikasi web.** Build TanStack Start jalan sebagai container Node di VPS di belakang Caddy, arahkan `crm.webhaus.id` ke sana.
7. **Update Twilio Console.** Ganti URL webhook inbound dan status callback ke domain VPS. Uji kirim & terima pesan, media, template follow-up.
8. **Cutover.** Freeze singkat (mis. malam hari), dump ulang delta, pindah DNS, pantau log gateway 24 jam. Rencana rollback: DNS dan webhook dikembalikan ke setup lama.
9. **Operasional.** `pg_dump` harian ke object storage murah, retensi 14–30 hari, uji restore, monitoring uptime + disk.

## 4. Catatan biaya

- Ukuran data 65 MB dengan ~15 ribu pesan: VPS 2 vCPU / 4 GB RAM / 80 GB SSD sudah cukup lapang untuk 12+ bulan ke depan; 4 vCPU / 8 GB kalau ingin kepala lebih longgar untuk realtime dan storage media.
- Tabel `whatsapp_gateway_logs` (25 MB) dan `audit_events` (13 MB) tumbuh paling cepat — tambahkan job pembersihan retensi (mis. 90 hari) supaya disk tidak boros.
- Biaya Twilio tidak berubah, karena tetap provider WhatsApp.
- Yang perlu dianggarkan di luar VPS: SMTP untuk email auth, penyimpanan backup, dan waktu pemeliharaan (update keamanan, monitoring) yang sebelumnya tidak ada.

## 5. Batasan yang perlu disepakati

Setelah pindah, saya tidak bisa menjalankan migrasi database atau deploy ke VPS Anda dari sini — perubahan skema akan saya berikan sebagai file SQL dan langkah deploy yang Anda jalankan sendiri (atau lewat CI). Kalau Anda ingin tetap bisa iterasi cepat dari Lovable, opsi tengah: database dan media tetap di VPS, aplikasi web tetap di-deploy dari sini.
