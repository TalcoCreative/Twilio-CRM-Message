# Perbaikan hitungan Continue Conversation saat rentang tanggal dipecah

## Temuan (sudah diverifikasi dengan data asli)

Saya menghitung ulang langsung dari data (`audit_events`) memakai logika yang sama persis dengan dashboard:

- 15–31 Juli: **117**
- 15–18 Juli: **27**, 19–24 Juli: **41**, 25–31 Juli: **46** → total **114**

Selisihnya persis **3 lead**, dan ketiganya adalah kasus **operan antar-FR yang terjadi tepat di batas periode**:

| Lead | FR sebelumnya | FR penerus | Waktu operan |
|---|---|---|---|
| 0b9432bd… | FR C (18 Juli 17:02) | FR A | 19 Juli 12:58 |
| 95d53d5e… | FR D (18 Juli 22:10) | FR A | 19 Juli 17:41 |
| 7458b48e… | FR C (24 Juli 17:49) | FR F | 25 Juli 06:51 |

Di rentang penuh ketiga operan ini terhitung. Saat dipecah, FR penerus menjadi FR pertama yang membalas di dalam sub-periode itu, dan operannya hilang dari hitungan.

**Penyebabnya di kode** (`src/routes/_app.dashboard.tsx`, blok First Response): saat sebuah balasan adalah balasan FR pertama di dalam rentang, agent tersebut sudah lebih dulu dimasukkan ke daftar "penyentuh lead" (`frTouchers`) sebelum pengecekan "apakah sebelum rentang ada FR lain". Pengecekan continue punya syarat "agent belum ada di daftar", sehingga syarat itu selalu gagal dan operan lintas-batas tidak pernah dihitung.

Artinya: **angka 117 yang benar**, dan angka per-periode-lah yang kurang (undercount), bukan sebaliknya.

## Yang akan diperbaiki

1. Urutkan ulang logikanya: cek dulu apakah ada FR lain sebelum rentang, baru daftarkan agent sebagai penyentuh lead — sehingga operan yang terjadi persis di batas periode ikut terhitung.
2. Pakai FR **terakhir** sebelum rentang (bukan FR pertama saja) sebagai pembanding, supaya rangkaian operan A → B → A juga terbaca benar.
3. Setelah perbaikan, hasil per-periode dijumlahkan akan cocok dengan hitungan rentang penuh (117) untuk kasus di atas.

Catatan: memecah rentang tetap tidak selalu menghasilkan penjumlahan identik untuk semua skenario (satu lead yang dioper bolak-balik di dua periode berbeda wajar terhitung di masing-masing periode). Tapi kasus "hilang" seperti 3 lead ini akan hilang.

## Teknis

- File: `src/routes/_app.dashboard.tsx`
- Fungsi terkait: `markContinueFromFR`, seeding `priorFRActor`, dan cabang `event_type === "chat_out"` pada loop `evs`.
- `priorFRActor` diubah menyimpan FR terakhir sebelum `startISO` (query prior sudah ada, tinggal ubah cara pengisian).
- Drill-down (`continueDetails`) otomatis ikut benar karena memakai jalur yang sama.
- Verifikasi: bandingkan ulang total 15–31 Juli vs jumlah tiga sub-periode setelah perubahan.
