## Revisi metrik Total Closing & Closing Share (tab First Response)

### Definisi baru

**Total Closing** (per agent)
- Hanya count kalau agent tsb yang **membuat invitation** ke agent non-FR (dan invitation di-accept).
- TIDAK dihitung dari continue conversation. Kalau fr2 cuma lanjutin balas tanpa bikin invitation → Total Closing fr2 = 0 untuk lead itu.
- Filter "Semua agent" = total invitation accepted dari divisi FR ke non-FR.

**Closing Share** (per agent)
- Hanya diberikan kalau ada **>1 unique FR** yang balas chat di lead itu sebelum invitation ke non-FR dibuat.
- Total share per closing = **1.0**, dibagi rata ke semua unique FR yang partisipasi (2 orang → 0.5/0.5, 3 orang → 0.333/0.333/0.333).
- Kalau cuma 1 FR yang handle solo dari awal sampai bikin invitation → **Closing Share = 0** untuk agent itu (dia sudah dapat Total Closing = 1, tidak ada share dibagi).

**Basis "closing"** = `assignment_invitations` dengan `status='accepted'`, `from_user_id ∈ FR`, `to_user_id ∉ FR`, dihitung sekali per invitation accepted (kalau lead di-reject lalu di-invite ulang & accepted, itu closing baru).

### Perubahan kode

File: `src/routes/_app.dashboard.tsx`, block loop `closingInvs` (baris 850–868).

Logika baru:
```
for inv in closingInvs:
  closerId = inv.from_user_id
  touchers = unique FR yang pernah chat_out di contact_id (dari frTouchers)
  if closerId not in touchers: touchers.push(closerId)

  ensureFR(closerId).closings++          // Total Closing hanya untuk closer

  if touchers.length > 1:                 // Closing Share hanya kalau multi-FR
    share = 1 / touchers.length
    for tid in touchers: ensureFR(tid).closingShare += share
  // else: solo → tidak ada share sama sekali

  // Handle time tetap dihitung untuk semua toucher (tidak berubah)
```

### Yang tidak berubah
- Continue Conversation, Avg First Response, Avg Handle Time, Leads Baru, SLA, chart lain: tetap.
- Definisi FR toucher (unique FR yang pernah `chat_out` di contact tsb sebelum invitation): tetap.
- KPI card "Closing Share" tetap tampil (bisa 0 kalau agent selalu solo).

### Verifikasi
- Build check via typecheck.
- Manual check angka: `Total Closing` global = jumlah row invitation accepted FR→non-FR di rentang; `Sum(Closing Share)` global = jumlah closing yang multi-FR (bukan total closing keseluruhan).
