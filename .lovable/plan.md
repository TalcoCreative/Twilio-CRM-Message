# Migrasi Hybrid: Database + Media ke VPS, Aplikasi Tetap di Lovable

## 1. Kondisi sekarang

| Lapisan | Sekarang | Setelah migrasi |
|---|---|---|
| Web app (TanStack Start, semua halaman) | Lovable | Tetap di Lovable |
| Postgres (20 tabel, total 65 MB) | Cloud terkelola | VPS Anda |
| PostgREST + RLS (semua query browser) | Cloud | VPS |
| Auth agent (GoTrue) | Cloud | VPS |
| Realtime (inbox live) | Cloud | VPS |
| Storage `chat-media` (foto/video/VN/PDF) | Cloud | VPS |
| Fungsi Twilio (webhook, send, status, followup, manage-agent) | Edge Functions Deno | Dikonversi jadi server route di app Lovable |
| WhatsApp | Twilio | Tetap Twilio (biaya tidak berubah) |

Data saat ini: messages 15.527 baris (6,5 MB), whatsapp_gateway_logs 25 MB, audit_events 13 MB, contacts/conversations masing-masing 938 baris.

## 2. Kecocokan VPS 1 vCPU / 4 GB / 50 GB NVMe

Cukup untuk skala sekarang, tapi 1 vCPU itu ketat kalau semua service Supabase dinyalakan. Supaya aman:

- Jalankan hanya service yang dipakai: Postgres, PostgREST, GoTrue, Realtime, Storage, Kong. Matikan Studio, Analytics/Logflare, Vector, dan Imgproxy (paling rakus CPU/RAM).
- Tambah swap 2–4 GB sebagai bantalan.
- Batasi `shared_buffers` ~1 GB dan `max_connections` secukupnya, plus pooler agar koneksi realtime tidak menghabiskan slot.
- Retensi otomatis untuk `whatsapp_gateway_logs` dan `audit_events` (mis. 90 hari) — dua tabel ini yang paling cepat memakan disk.
- Media WhatsApp yang menumpuk adalah risiko disk 50 GB terbesar; pantau, dan siapkan opsi pindah media ke object storage murah kalau mendekati 60% penuh.

## 3. Konsekuensi mode hybrid yang perlu disepakati

Aplikasi di Lovable saat ini terhubung ke database lewat modul klien yang dikelola otomatis dan tidak boleh diedit. Supaya app menunjuk ke VPS, dibuat modul klien baru yang membaca URL + key VPS, lalu **19 file** yang sekarang mengimpor klien lama dialihkan ke modul baru (inbox, leads, dashboard, settings, ads-content, invitations, auth, hooks, dan komponen terkait).

Konsekuensinya:
- Setelah beralih, tool database Lovable (migrasi, query, storage) tidak lagi menyentuh data produksi Anda. Perubahan skema saya serahkan sebagai file SQL untuk Anda jalankan di VPS.
- VPS harus punya domain + HTTPS (mis. `api.crm.webhaus.id`), karena browser pengguna mengakses database Anda langsung lewat PostgREST/Realtime.
- CORS di VPS wajib mengizinkan domain app (`crm.webhaus.id` dan URL preview).

## 4. Langkah migrasi

1. **Siapkan VPS**: Ubuntu, Docker + Compose, firewall (hanya 80/443 publik, port Postgres tertutup), Caddy untuk TLS otomatis, subdomain `api.crm.webhaus.id`.
2. **Deploy stack Supabase self-host** dengan service minimal di atas; set JWT secret, anon key, service key, SMTP untuk email auth, volume terpisah untuk data Postgres dan storage.
3. **Tuning Postgres + swap** sesuai bagian 2.
4. **Pindahkan skema & data**: dump schema `public` + `auth`, restore di VPS. Verifikasi jumlah baris per tabel, semua enum (`app_role`, `message_type`, dll), 8 fungsi database, 13 trigger, dan seluruh RLS policy. Akun agent ikut pindah lewat schema `auth`, jadi password lama tetap berlaku.
5. **Pindahkan media**: sinkronkan isi bucket `chat-media` ke storage VPS, cek beberapa lampiran lama di inbox masih tampil.
6. **Sambungkan app ke VPS**: buat modul klien baru + alihkan 19 file, aktifkan Realtime untuk `messages`, `conversations`, `contacts`, set CORS.
7. **Pindahkan fungsi Twilio**: konversi `twilio-webhook`, `twilio-send`, `twilio-status`, `twilio-followup`, `twilio-followup-backfill`, `notify-agent-assign`, `manage-agent` menjadi route `src/routes/api/public/*` di app, dengan secret Twilio disimpan sebagai secret app. Validasi signature Twilio disesuaikan dengan URL baru.
8. **Uji end-to-end di preview**: kirim & terima pesan, media (foto/video/VN/PDF), status delivery, template follow-up, login agent, RLS per role (FR vs agent vs admin), dashboard & ads-content.
9. **Cutover**: freeze singkat di jam sepi, dump delta terakhir, arahkan app ke VPS, update URL webhook + status callback di Twilio Console, pantau log gateway 24 jam. Rollback = kembalikan URL webhook dan arahkan app ke database lama.
10. **Operasional**: `pg_dump` harian + backup folder media ke penyimpanan terpisah, retensi 14–30 hari, uji restore sekali, monitoring uptime dan disk.

## 5. Pembagian tugas

Saya kerjakan: konversi fungsi Twilio ke server route, modul klien + pengalihan 19 file, file SQL untuk skema/RLS/retensi, docker compose + konfigurasi Caddy, skrip dump/restore dan sinkronisasi media, checklist verifikasi.

Anda kerjakan: provisioning VPS dan DNS, menjalankan compose + skrip di server, mengisi secret di VPS, mengubah URL webhook di Twilio Console.

## 6. Catatan biaya

- VPS yang ada sudah menutup DB + auth + realtime + storage — tidak ada biaya cloud tambahan setelah pindah.
- Tambahan yang perlu dianggarkan: SMTP untuk email auth, penyimpanan backup di luar VPS, dan waktu pemeliharaan (update keamanan, monitoring).
- Twilio tetap sesuai pemakaian, tidak berubah.
- Penghematan nyata baru terasa kalau retensi log dan media dijaga; tanpa itu, disk 50 GB jadi batas dalam beberapa bulan.

## 7. Urutan eksekusi yang disarankan

Tahap 1 (langkah 1–3) siapkan VPS. Tahap 2 (4–5) pindah data & media, database lama tetap jalan. Tahap 3 (6–8) sambungkan dan uji di preview. Tahap 4 (9–10) cutover dan operasional. Setiap tahap bisa dihentikan tanpa mengganggu sistem yang sedang berjalan.
