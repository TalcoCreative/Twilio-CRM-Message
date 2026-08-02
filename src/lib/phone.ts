// Normalisasi nomor WhatsApp.
// Hanya format LOKAL Indonesia (diawali 0, atau 8xxxxxxxx) yang diberi prefix 62.
// Nomor internasional (mis. +971..., 65..., 1...) dibiarkan apa adanya agar
// tidak berubah jadi 62971... yang membuat pengiriman gagal.
export function normalizeWa(input: string): string {
  const raw = String(input || "").trim();
  const hadPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (!/^\d{7,15}$/.test(digits)) return "";
  if (hadPlus) return digits; // sudah E.164
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("8")) return "62" + digits;
  return digits;
}
