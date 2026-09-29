import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, ArrowUp, ArrowDown, Download, ClipboardList } from "lucide-react";
import * as XLSX from "xlsx";

export type WebinarQuestion = { key: string; label: string; prompt: string; map?: string };

export const DEFAULT_WEBINAR_QUESTIONS: WebinarQuestion[] = [
  { key: "nama", label: "Nama", prompt: "Boleh kami tahu nama lengkap kamu?", map: "full_name" },
  { key: "usia", label: "Usia", prompt: "Berapa usia kamu saat ini?", map: "age" },
  { key: "domisili", label: "Domisili", prompt: "Kamu berdomisili di kota mana?", map: "domicile" },
  { key: "pernah_periksa", label: "Sudah pernah periksa prostat?", prompt: "Apakah kamu sudah pernah periksa prostat sebelumnya? (Sudah/Belum)" },
  { key: "pembayaran", label: "Metode pembayaran", prompt: "Jika nanti melakukan tindakan, metode pembayaran apa yang dipertimbangkan? (BPJS / ASURANSI / PRIBADI)" },
  { key: "pertanyaan", label: "Pertanyaan untuk dokter", prompt: "Terakhir, ada pertanyaan yang ingin kamu sampaikan ke dokter saat webinar?" },
];

const MAP_OPTIONS = [
  { v: "", l: "Hanya disimpan di data webinar" },
  { v: "full_name", l: "Juga isi Nama kontak" },
  { v: "age", l: "Juga isi Usia kontak" },
  { v: "domicile", l: "Juga isi Domisili kontak" },
];

export function WebinarQuestionsEditor({ value, onChange }: { value: WebinarQuestion[]; onChange: (q: WebinarQuestion[]) => void }) {
  const set = (i: number, p: Partial<WebinarQuestion>) => onChange(value.map((q, j) => (j === i ? { ...q, ...p } : q)));
  const move = (i: number, d: number) => {
    const n = [...value]; const t = n[i + d]; if (!t) return; n[i + d] = n[i]!; n[i] = t; onChange(n);
  };
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Label className="flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Form Pendaftaran (ditanyakan satu per satu)</Label>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onChange(DEFAULT_WEBINAR_QUESTIONS)}>Pakai form prostat</Button>
          <Button size="sm" variant="outline" onClick={() => onChange([...value, { key: `q${Date.now()}`, label: "Pertanyaan baru", prompt: "" }])}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Pertanyaan
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Setelah pasien kirim kode, bot menanyakan pertanyaan ini berurutan. Setelah semua dijawab, baru pesan terima kasih + link Zoom dikirim.
        Kosongkan semua pertanyaan kalau ingin langsung kirim link. No WhatsApp tercatat otomatis.
      </p>
      {value.map((q, i) => (
        <div key={q.key + i} className="grid gap-2 md:grid-cols-[1fr_2fr_1fr_auto] items-start border-t pt-2">
          <Input value={q.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Judul kolom" />
          <Input value={q.prompt} onChange={(e) => set(i, { prompt: e.target.value })} placeholder="Pertanyaan yang dikirim bot" />
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={q.map || ""} onChange={(e) => set(i, { map: e.target.value || undefined })}>
            {MAP_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <div className="flex">
            <Button size="icon" variant="ghost" onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        </div>
      ))}
    </div>
  );
}

type Reg = { id: string; created_at: string; answers: Record<string, string> | null; contact: { full_name: string | null; whatsapp_number: string } | null };

export function WebinarAnswersTable({ webinarId, webinarName, questions }: { webinarId: string; webinarName: string; questions: WebinarQuestion[] }) {
  const [rows, setRows] = useState<Reg[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase.from("webinar_registrations")
      .select("id,created_at,answers,contact:contacts(full_name,whatsapp_number)")
      .eq("webinar_id", webinarId).order("created_at", { ascending: false })
      .then(({ data }) => setRows((data as any) || []));
  }, [open, webinarId]);

  const fmt = (s: string) => new Date(s).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  const val = (r: Reg, q: WebinarQuestion) => r.answers?.[q.key] ?? (q.map === "full_name" ? r.contact?.full_name ?? "" : "");
  const cols = questions.filter((q) => q.map !== "full_name");

  function exportXlsx() {
    const data = rows.map((r) => ({
      Waktu: fmt(r.created_at),
      Nama: val(r, { key: "nama", label: "", prompt: "", map: "full_name" }) || r.contact?.full_name || "",
      "No WhatsApp": r.contact?.whatsapp_number || r.answers?.whatsapp || "",
      ...Object.fromEntries(cols.map((q) => [q.label, val(r, q)])),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Pendaftar");
    XLSX.writeFile(wb, `pendaftar-${webinarName.replace(/\s+/g, "-")}.xlsx`);
  }

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>Data Pendaftar</Label>
        <div className="flex gap-2">
          {open && <Button size="sm" variant="outline" onClick={exportXlsx}><Download className="h-3.5 w-3.5 mr-1" /> Export Excel</Button>}
          <Button size="sm" variant="outline" onClick={() => setOpen(!open)}>{open ? "Tutup" : "Lihat data"}</Button>
        </div>
      </div>
      {open && (
        <div className="overflow-auto max-h-96">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="text-left p-1.5">Waktu</th><th className="text-left p-1.5">Nama</th><th className="text-left p-1.5">No WhatsApp</th>
                {cols.map((q) => <th key={q.key} className="text-left p-1.5">{q.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="p-1.5 whitespace-nowrap">{fmt(r.created_at)}</td>
                  <td className="p-1.5">{r.answers?.nama || r.contact?.full_name || "-"}</td>
                  <td className="p-1.5">{r.contact?.whatsapp_number || r.answers?.whatsapp || "-"}</td>
                  {cols.map((q) => <td key={q.key} className="p-1.5">{val(r, q) || "-"}</td>)}
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={3 + cols.length} className="p-3 text-center text-muted-foreground">Belum ada pendaftar.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
