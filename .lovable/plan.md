## Fix konsistensi timezone WIB di dashboard

### Masalah
Screenshot user: KPI Pesan = 630, tapi tooltip 07-15 Masuk 287 + Keluar 299 = 586. Selisih 44 pesan "hilang" dari chart karena bucket harian pakai UTC padahal range query pakai local (WIB).

Sandbox/browser jalan di WIB. `new Date(sent_at).toISOString().slice(0,10)` = tanggal UTC. Pesan yang dikirim 00:00–06:59 WIB → UTC-nya masih tanggal sebelumnya → bucket ke tanggal yang tidak tampil di chart.

### Lokasi bug
`src/routes/_app.dashboard.tsx`:
1. **Line 212–213** — `startDate`/`endDate` untuk lookup `agent_shifts.work_date`. UTC-date dari WIB-midnight = tanggal sebelumnya → shift date mismatch off-by-one.
2. **Line 350** — bucket "Volume Pesan Harian" (bug yang di-report).
3. **Line 953** — iterator per-tanggal di FR tab; key-nya bentrok sama line 974 yang sudah pakai local date (mismatch → data hari tertentu bisa 0).

### Fix
Tambah helper lokal di file yang sama:
```ts
const localDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
```

Ganti 3 titik:
- L212–213: `localDateKey(new Date(startISO))` / `localDateKey(new Date(endISO))`
- L350: `localDateKey(new Date(m.sent_at))`
- L953: `localDateKey(d)`

### Yang tidak berubah
- `startISO`/`endISO` sudah benar (local midnight → UTC ISO), tidak perlu diubah.
- Bucket per jam (`getHours()`) sudah local, tidak perlu diubah.
- Query Supabase (pakai ISO with offset) tidak berubah.

### Verifikasi
- Angka KPI Pesan = sum of (Masuk + Keluar) di chart Volume Pesan Harian.
- Distribusi jam FR tetap konsisten.
