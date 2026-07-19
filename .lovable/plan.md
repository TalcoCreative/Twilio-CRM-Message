## Tujuan
Mengubah penghapusan akun agent dari **hard delete** menjadi **soft delete/nonaktifkan**, dengan dialog konfirmasi yang memungkinkan Super Admin memilih nasib data lead & chat yang ditangani agent tersebut.

## Perilaku saat ini
- Tombol "Hapus" di Settings → Tim Agent langsung memanggil `admin.auth.admin.deleteUser()`.
- Akun auth, profil, dan role hilang permanen.
- Lead, chat, dan log tetap ada, tapi referensi agent (assigned_agent_id, sent_by_id, dll) berubah menjadi NULL.
- Shift dan assignment invitation ikut terhapus.

## Perilaku yang diinginkan
1. **Soft delete sebagai default**: akun agent tidak dihapus dari auth.users, tapi `profiles.is_active = false` dan semua sesi login-nya dihapus.
2. **Dialog konfirmasi** sebelum nonaktifkan dengan pilihan:
   - **Reassign leads & conversations** ke agent lain (dropdown pilih agent aktif).
   - **Biarkan unassigned** (assigned_agent_id jadi NULL).
3. **Tetap ada opsi hard delete permanen** untuk Super Admin, tapi diisolasi di menu lanjutan dengan peringatan.
4. **Agent nonaktif tidak bisa login**: auth flow memeriksa `profiles.is_active` setelah sign-in dan menolak dengan pesan "Akun dinonaktifkan".
5. **Tampilan Tim Agent**: tampilkan status aktif/nonaktif dan tombol **Aktifkan kembali** untuk akun yang dinonaktifkan.

## Perubahan teknis

### Database
- Tidak perlu migrasi besar; kolom `profiles.is_active` sudah ada.
- Tambahkan `updated_at` trigger/upsert handling jika belum konsisten.
- Pastikan `profiles` tetap punya GRANT dan RLS policy yang memungkinkan Super Admin mengubah `is_active` orang lain.

### Edge Function
- File: `supabase/functions/manage-agent/index.ts`
- Tambahkan action:
  - `disable`: set `profiles.is_active = false`, hapus semua sesi user (`admin.auth.admin.signOut(target)` / revoke sessions), log `disable_agent`.
  - `reactivate`: set `profiles.is_active = true`, log `reactivate_agent`.
  - `reassign`: terima `from_user_id` dan `to_user_id`, pindahkan `contacts.assigned_agent_id` dan `conversations.assigned_agent_id` dari agent lama ke agent baru, log `reassign_agent_data`.
- Pertahankan `delete` action yang sudah ada, tapi jadikan opsi lanjutan (hard delete).

### UI Settings → Tim Agent
- File: `src/routes/_app.settings.tsx`
- Ganti konfirmasi hapus sederhana dengan dialog bertahap:
  1. Pilih aksi: **Nonaktifkan saja** / **Hapus permanen**.
  2. Jika nonaktifkan: pilih apakah lead & chat direassign ke agent lain atau dibiarkan unassigned.
  3. Konfirmasi akhir dengan nama agent dan ringkasan dampak.
- Tampilkan badge "Nonaktif" di daftar agent.
- Tampilkan tombol **Aktifkan** untuk agent nonaktif.
- Filter default tampilkan semua agent, dengan toggle lihat hanya aktif/nonaktif.

### Auth flow
- File: `src/routes/auth.tsx` dan `src/hooks/use-auth.ts`
- Setelah `signInWithPassword` berhasil, panggil `supabase.from("profiles").select("is_active").eq("id", user.id).maybeSingle()`.
- Jika `is_active = false`, panggil `supabase.auth.signOut()` dan tampilkan toast/error "Akun ini telah dinonaktifkan. Hubungi Super Admin."
- Di hook `useAuth`, jika session ada tapi profil menunjukkan `is_active = false`, bersihkan session dan arahkan ke `/auth`.

### Query agent aktif
- Perbarui query yang memuat daftar agent untuk assignment/invite/dashboard agar hanya menampilkan `is_active = true` kecuali memang butuh riwayat (misalnya drill-down log masih bisa lihat agent nonaktif dari metadata).
- Contoh query yang perlu ditambahkan filter: `supabase.from("profiles").select("...").eq("is_active", true)`.

## Hal yang tidak berubah
- Data lead, kontak, chat, pesan, dan log tidak ikut terhapus saat soft delete.
- Hard delete permanen tetap tersedia tapi tidak sebagai default.
- Super Admin tetap satu-satunya role yang bisa mengelola akun agent.

## Tahapan implementasi
1. Perbarui `manage-agent` Edge Function dengan action `disable`, `reactivate`, dan `reassign`.
2. Perbarui UI Settings → Tim Agent (dialog konfirmasi, badge status, tombol aktifkan).
3. Tambahkan pengecekan `is_active` di flow login dan `useAuth`.
4. Tambahkan filter `is_active = true` di query daftar agent untuk assignment/invite/dashboard.
5. Verifikasi build dan uji coba: nonaktifkan akun, coba login, reassign data, aktifkan kembali.
