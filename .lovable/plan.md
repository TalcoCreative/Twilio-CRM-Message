# Tarik Ulang Chat Masuk dari Twilio (Backfill Inbox)

Bisa. Twilio menyimpan riwayat pesan di akunnya, jadi chat yang masuk saat Cloud mati masih bisa ditarik dan dimasukkan ke inbox seperti pesan normal.

## Yang akan dibuat

**Fungsi baru `twilio-backfill`** (super admin only) yang:
- Mengambil daftar pesan dari Twilio untuk rentang tanggal yang dipilih (mis. periode credits habis).
- Untuk tiap pesan masuk (inbound WhatsApp): buat/temukan kontak, buat/temukan percakapan, lalu simpan pesan.
- Anti-duplikat: pesan yang sudah ada (berdasarkan Message SID) dilewati, jadi aman dijalankan berkali-kali.
- Waktu pesan memakai waktu asli dari Twilio, bukan waktu import — supaya urutan chat dan metrik dashboard tetap benar.
- Media (foto/dokumen/voice) ikut ditarik dan disimpan ulang di storage, sama seperti webhook biasa.
- Pesan keluar (outbound) juga disinkronkan statusnya bila belum tercatat.
- Deteksi kode konten ads dan stage default tetap berjalan untuk kontak baru, sehingga leads dari iklan ikut muncul di /leads dan /ads-content.
- Setiap batch dicatat di WhatsApp Gateway Logs.

**UI di Settings → WhatsApp Gateway**: panel "Tarik Riwayat dari Twilio" berisi pilihan tanggal mulai–selesai, tombol "Preview" (lihat berapa pesan & kontak yang akan ditarik, tanpa menyimpan) dan tombol "Tarik & Simpan", plus ringkasan hasil (jumlah pesan baru, kontak baru, duplikat dilewati).

## Catatan penting

- Chatbot/workflow otomatis TIDAK dijalankan ulang untuk pesan lama (agar tidak mengirim balasan telat ke pelanggan). Pesan hanya dimasukkan ke inbox.
- Balasan ke pesan lama tetap tunduk aturan 24 jam WhatsApp — kalau sudah lewat, harus pakai tombol Follow Up (template).
- Riwayat Twilio umumnya tersimpan lama, jadi 7 leads yang hilang beberapa hari lalu seharusnya masih bisa ditarik.

## Teknis

- `supabase/functions/twilio-backfill/index.ts`: paging `GET /2010-04-01/Accounts/{Sid}/Messages.json` dengan `DateSent>`/`DateSent<`, filter `To` = nomor WhatsApp gateway untuk inbound; auth memakai helper `basicAuthHeader` + fallback Auth Token yang sudah ada di `_shared/twilio.ts`.
- Reuse `normalizePhone`, `toWhatsapp`, `detectMediaType`; logika pembuatan kontak/percakapan/media disamakan dengan `twilio-webhook` (diekstrak ke helper bersama agar tidak dobel).
- Dedupe lewat kolom `messages.fonnte_message_id` (menyimpan Message SID).
- `sent_at` dan `created_at` diisi dari `date_sent` Twilio; `conversations.last_message_at`, `first_inbound_at`, dan preview diperbarui hanya bila lebih baru.
- Verifikasi peran super admin via `has_role` sebelum eksekusi; mode `dry_run` untuk preview.
