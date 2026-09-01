/**
 * Lead temperature (prioritas lead) — dipakai di Inbox, Leads, Dashboard, dan Ads Content.
 * Disimpan di kolom contacts.lead_temperature dengan nilai 'HOT' | 'WARM' | 'COLD' (atau null).
 */
export type LeadTemperature = "HOT" | "WARM" | "COLD";

export const LEAD_TEMPERATURES: { value: LeadTemperature; label: string; color: string; hint: string }[] = [
  { value: "HOT", label: "Hot", color: "#ef4444", hint: "Siap closing / sudah tanya harga & jadwal" },
  { value: "WARM", label: "Warm", color: "#f59e0b", hint: "Masih pertimbangan, butuh follow up" },
  { value: "COLD", label: "Cold", color: "#3b82f6", hint: "Sekadar tanya / belum ada niat dekat" },
];

export const TEMP_NONE_LABEL = "Belum diklasifikasi";
export const TEMP_NONE_COLOR = "#94a3b8";

export function tempLabel(v?: string | null) {
  return LEAD_TEMPERATURES.find((t) => t.value === v)?.label || TEMP_NONE_LABEL;
}

export function tempColor(v?: string | null) {
  return LEAD_TEMPERATURES.find((t) => t.value === v)?.color || TEMP_NONE_COLOR;
}

/** Hitung sebaran Hot/Warm/Cold (+ belum diklasifikasi) dari daftar kontak. */
export function tempDistribution<T extends { lead_temperature?: string | null }>(rows: T[]) {
  const counts: Record<string, number> = { HOT: 0, WARM: 0, COLD: 0, NONE: 0 };
  rows.forEach((r) => {
    const k = r.lead_temperature && counts[r.lead_temperature] !== undefined ? r.lead_temperature : "NONE";
    counts[k]++;
  });
  return [
    ...LEAD_TEMPERATURES.map((t) => ({ key: t.value, name: t.label, color: t.color, count: counts[t.value] })),
    { key: "NONE", name: TEMP_NONE_LABEL, color: TEMP_NONE_COLOR, count: counts.NONE },
  ];
}
