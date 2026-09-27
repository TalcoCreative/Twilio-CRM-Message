# Tambah Follow Up Rezum Pendaftaran

## Perubahan
- Tambahkan pengaturan Content SID terpisah untuk **Follow Up Rezum Pendaftaran**, dengan nilai awal `HX18ee54168a8e79ef4693be0774ddcee8`.
- Pertahankan Content SID **Follow Up Regular** yang sudah ada tanpa perubahan.
- Perluas pengiriman template agar menerima pilihan `regular` atau `rezum`; template Rezum hanya mengirim variabel `{{1}}` berisi nama pasien.
- Ubah chatbox Inbox menjadi dua pilihan: **Follow Up Regular Message** dan **Follow Up Rezum Pendaftaran**.
- Simpan isi template yang sudah dirender sebagai chat bubble dan tetap catat status/error pengiriman seperti Follow Up lama.

## Keamanan dan aturan
- Aturan kunci akun First Response pada chat webinar tetap berlaku untuk kedua pilihan.
- SID Rezum dapat diganti dan disimpan kembali dari Developer Mode.
- Pengiriman tetap memakai kredensial Twilio yang sudah ada; tidak ada template lama yang ditimpa.

## Verifikasi
- Terapkan nilai awal ke database.
- Perbarui fungsi pengiriman WhatsApp.
- Pastikan aplikasi berhasil dibangun dan kedua pilihan tampil rapi di chatbox.
