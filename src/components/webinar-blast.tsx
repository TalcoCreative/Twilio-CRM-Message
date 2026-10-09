import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { blastWebinar } from "@/lib/webinar-blast.functions";
import { normalizeWa } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Send, Trash2, UserPlus, Download, Upload } from "lucide-react";
import * as XLSX from "xlsx";

type Recipient = {
  id: string; whatsapp_number: string; full_name: string | null;
  last_status: string | null; last_error: string | null; last_sent_at: string | null;
  send_count: number; conversation_id: string | null;
  reminder_status: string | null; reminder_sent_at: string | null; reminder_error: string | null;
  reminder_h_status: string | null; reminder_h_sent_at: string | null; reminder_h_error: string | null;
};

type BlastKind = "blast" | "reminder" | "reminder_h";

export function WebinarBlastPanel({ webinarId }: { webinarId: string }) {
  const blast = useServerFn(blastWebinar);
  const [rows, setRows] = useState<Recipient[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [chatted, setChatted] = useState<Set<string>>(new Set());

  async function syncRegistrants() {
    // Semua pendaftar webinar otomatis masuk daftar blasting
    const { data: regs } = await supabase.from("webinar_registrations")
      .select("contact_id, contacts(whatsapp_number, full_name)").eq("webinar_id", webinarId).limit(5000);
    const items = (regs || []).map((r: any) => r.contacts).filter((c: any) => c?.whatsapp_number)
      .map((c: any) => ({ webinar_id: webinarId, whatsapp_number: c.whatsapp_number, full_name: c.full_name || null }));
    if (items.length) {
      await supabase.from("webinar_blast_recipients" as any)
        .upsert(items as any, { onConflict: "webinar_id,whatsapp_number", ignoreDuplicates: true });
    }
  }

  async function load() {
    const { data, error } = await supabase.from("webinar_blast_recipients" as any)
      .select("*").eq("webinar_id", webinarId).order("created_at", { ascending: false });
    if (error) return toast.error(error.message);
    const list = (data as any as Recipient[]) || [];
    setRows(list);
    const nums = list.map((r) => r.whatsapp_number);
    if (nums.length) {
      const { data: cs } = await supabase.from("contacts").select("whatsapp_number").in("whatsapp_number", nums.slice(0, 500));
      setChatted(new Set((cs || []).map((c) => c.whatsapp_number)));
    }
  }
  useEffect(() => { syncRegistrants().finally(load); }, [webinarId]);

  async function addRows(items: { phone: string; name: string }[]) {
    const all = items.map((i) => ({ whatsapp_number: normalizeWa(i.phone), full_name: String(i.name || "").trim() || null }))
      .filter((i) => i.whatsapp_number);
    // Hapus duplikat dalam file (yang pertama dipertahankan)
    const seen = new Set<string>();
    const clean = all.filter((i) => (seen.has(i.whatsapp_number) ? false : (seen.add(i.whatsapp_number), true)));
    const dupInFile = all.length - clean.length;
    if (!clean.length) return toast.error("Tidak ada nomor valid");
    const existing = new Set(rows.map((r) => r.whatsapp_number));
    const fresh = clean.filter((c) => !existing.has(c.whatsapp_number));
    const dupInList = clean.length - fresh.length;
    setBusy(true);
    const { error } = await supabase.from("webinar_blast_recipients" as any).upsert(
      clean.map((c) => ({ ...c, webinar_id: webinarId })) as any,
      { onConflict: "webinar_id,whatsapp_number" },
    );
    setBusy(false);
    if (error) return toast.error(error.message);
    const dup = dupInFile + dupInList;
    toast.success(`${fresh.length} nomor baru ditambahkan${dup ? `, ${dup} nomor ganda dilewati` : ""}`);
    setPhone(""); setName(""); setBulk("");
    load();
  }

  function addBulk() {
    const items = bulk.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const [p, ...rest] = l.split(/[,;\t]/);
      return { phone: p || "", name: rest.join(" ").trim() };
    });
    addRows(items);
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([["Nomor WA", "Nama"], ["081234567890", "Budi"], ["6285678901234", "Siti"]]);
    ws["!cols"] = [{ wch: 20 }, { wch: 30 }];
    ws["A2"].t = "s"; ws["A3"].t = "s";
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Daftar Nomor");
    XLSX.writeFile(wb, "template-blast-webinar.xlsx");
  }

  async function importFile(file: File) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, defval: "" });
      const items = data
        .filter((r, i) => !(i === 0 && /nomor|phone|wa/i.test(String(r[0]))))
        .map((r) => ({ phone: String(r[0] ?? ""), name: String(r[1] ?? "") }))
        .filter((r) => r.phone.trim());
      if (!items.length) return toast.error("File kosong atau tidak sesuai template");
      await addRows(items);
    } catch (e: any) {
      toast.error("Gagal membaca file: " + (e?.message || ""));
    }
  }

  async function removeSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    const { error } = await supabase.from("webinar_blast_recipients" as any).delete().in("id", ids);
    if (error) return toast.error(error.message);
    setSelected(new Set());
    load();
  }

  // Dikirim per 50 nomor supaya permintaan tidak terlalu lama (tidak ada batas total).
  async function sendChunks(ids: string[], kind: BlastKind) {
    let sent = 0, failed = 0;
    const total = Math.ceil(ids.length / 50);
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const part = Math.floor(i / 50) + 1;
      if (total > 1) toast.loading(`Mengirim bagian ${part}/${total} (${chunk.length} nomor)…`, { id: "blast-progress" });
      const r = await blast({ data: { recipient_ids: chunk, kind } });
      sent += r.sent; failed += r.failed;
    }
    toast.dismiss("blast-progress");
    return { sent, failed };
  }

  async function send() {
    const ids = [...selected];
    if (!ids.length) return toast.error("Pilih nomor dulu");
    if (!confirm(`Kirim template webinar ke ${ids.length} nomor?`)) return;
    setSending(true);
    try {
      const r = await sendChunks(ids, "blast");
      toast.success(`Terkirim ${r.sent}, gagal ${r.failed}`);
      setSelected(new Set());
    } catch (e: any) {
      toast.dismiss("blast-progress");
      toast.error(e?.message || "Gagal blasting");
    }
    setSending(false);
    load();
  }

  async function sendReminder() {
    const ids = [...selected].filter((id) => rows.find((r) => r.id === id)?.reminder_status !== "sent");
    if (!ids.length) return toast.error("Semua nomor terpilih sudah dikirim reminder");
    if (!confirm(`Kirim Follow Up Reminder ke ${ids.length} nomor? (nomor yang sudah dapat reminder dilewati)`)) return;
    setSending(true);
    try {
      const r = await sendChunks(ids, "reminder");
      toast.success(`Reminder terkirim ${r.sent}, gagal ${r.failed}`);
      setSelected(new Set());
    } catch (e: any) {
      toast.dismiss("blast-progress");
      toast.error(e?.message || "Gagal kirim reminder");
    }
    setSending(false);
    load();
  }

  async function sendReminderH() {
    const ids = [...selected].filter((id) => rows.find((r) => r.id === id)?.reminder_h_status !== "sent");
    if (!ids.length) return toast.error("Semua nomor terpilih sudah dikirim Reminder Hari H");
    if (!confirm(`Kirim Reminder Hari H ke ${ids.length} nomor? (nomor yang sudah dapat Reminder Hari H dilewati)`)) return;
    setSending(true);
    try {
      const r = await sendChunks(ids, "reminder_h");
      toast.success(`Reminder Hari H terkirim ${r.sent}, gagal ${r.failed}`);
      setSelected(new Set());
    } catch (e: any) {
      toast.dismiss("blast-progress");
      toast.error(e?.message || "Gagal kirim Reminder Hari H");
    }
    setSending(false);
    load();
  }

  const stats = useMemo(() => ({
    total: rows.length,
    sent: rows.filter((r) => r.last_status === "sent").length,
    failed: rows.filter((r) => r.last_status === "failed").length,
    reminded: rows.filter((r) => r.reminder_status === "sent").length,
    remindedH: rows.filter((r) => r.reminder_h_status === "sent").length,
    fresh: rows.filter((r) => !chatted.has(r.whatsapp_number)).length,
  }), [rows, chatted]);

  const allChecked = rows.length > 0 && selected.size === rows.length;

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium mr-auto">Blasting Undangan (Template Webinar)</p>
        <Badge variant="secondary">Total {stats.total}</Badge>
        <Badge variant="secondary">Belum ada di Chatbox {stats.fresh}</Badge>
        <Badge>Terkirim {stats.sent}</Badge>
        <Badge variant="outline">Reminder ✓ {stats.reminded}</Badge>
        <Badge variant="outline">Hari H ✓ {stats.remindedH}</Badge>
        {stats.failed > 0 && <Badge variant="destructive">Gagal {stats.failed}</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">
        Pesan memakai template webinar dengan <b>{"{{1}}"}</b> = nama. Semua pendaftar webinar otomatis masuk daftar ini; nomor lain bisa ditambah manual/import. Follow Up Reminder hanya bisa dikirim sekali per nomor. Nomor yang sudah pernah chat masuk ke chat yang sama di Inbox; nomor baru otomatis dibuatkan chat baru.
      </p>

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input placeholder="Nomor WA (0812...)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Input placeholder="Nama" value={name} onChange={(e) => setName(e.target.value)} />
        <Button onClick={() => addRows([{ phone, name }])} disabled={busy || !phone.trim()}>
          <UserPlus className="h-4 w-4 mr-2" /> Tambah
        </Button>
      </div>
      <div className="space-y-2">
        <Textarea rows={3} value={bulk} onChange={(e) => setBulk(e.target.value)}
          placeholder={"Tempel banyak sekaligus, satu per baris:\n08123456789, Budi\n08567890123, Siti"} className="text-xs" />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={addBulk} disabled={busy || !bulk.trim()}>Simpan Daftar</Button>
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-1" /> Download Template
          </Button>
          <Button variant="outline" size="sm" disabled={busy} asChild>
            <label className="cursor-pointer">
              <Upload className="h-4 w-4 mr-1" /> Import Excel/CSV
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
            </label>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allChecked}
            onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
          Pilih semua
        </label>
        <Button size="sm" variant="outline" onClick={() => setSelected(new Set(rows.filter((r) => r.last_status !== "sent").map((r) => r.id)))}>
          Pilih yang belum terkirim
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSelected(new Set(rows.filter((r) => r.reminder_status !== "sent").map((r) => r.id)))}>
          Pilih yang belum reminder
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSelected(new Set(rows.filter((r) => r.reminder_h_status !== "sent").map((r) => r.id)))}>
          Pilih yang belum Hari H
        </Button>
        <Button size="sm" variant="ghost" onClick={removeSelected} disabled={!selected.size}>
          <Trash2 className="h-4 w-4 mr-1 text-destructive" /> Hapus
        </Button>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={sendReminder} disabled={sending || !selected.size}>
          <Send className="h-4 w-4 mr-2" /> Follow Up Reminder
        </Button>
        <Button size="sm" variant="secondary" onClick={sendReminderH} disabled={sending || !selected.size}>
          <Send className="h-4 w-4 mr-2" /> Reminder Hari H
        </Button>
        <Button size="sm" onClick={send} disabled={sending || !selected.size}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
          Blast ke {selected.size} nomor
        </Button>
      </div>

      <div className="max-h-80 overflow-auto rounded border divide-y">
        {rows.length === 0 && <p className="p-3 text-xs text-muted-foreground">Belum ada nomor.</p>}
        {rows.map((r) => (
          <label key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
            <input type="checkbox" checked={selected.has(r.id)} onChange={(e) => {
              const n = new Set(selected); e.target.checked ? n.add(r.id) : n.delete(r.id); setSelected(n);
            }} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{r.full_name || "(tanpa nama)"}</div>
              <div className="text-xs text-muted-foreground">{r.whatsapp_number}</div>
              {r.last_error && <div className="text-xs text-destructive truncate">{r.last_error}</div>}
            </div>
            {chatted.has(r.whatsapp_number)
              ? <Badge variant="outline">Sudah ada di Chatbox</Badge>
              : <Badge variant="secondary">Belum ada di Chatbox</Badge>}
            {r.last_status === "sent" && <Badge>Terkirim{r.send_count > 1 ? ` ×${r.send_count}` : ""}</Badge>}
            {r.last_status === "failed" && <Badge variant="destructive">Gagal</Badge>}
            {r.reminder_status === "sent" && <Badge className="bg-primary/15 text-primary hover:bg-primary/15">✓ Reminder terkirim</Badge>}
            {r.reminder_status === "failed" && <Badge variant="destructive" title={r.reminder_error || ""}>Reminder gagal</Badge>}
            {r.reminder_h_status === "sent" && <Badge className="bg-primary/15 text-primary hover:bg-primary/15">✓ Hari H terkirim</Badge>}
            {r.reminder_h_status === "failed" && <Badge variant="destructive" title={r.reminder_h_error || ""}>Hari H gagal</Badge>}
          </label>
        ))}
      </div>
    </div>
  );
}
