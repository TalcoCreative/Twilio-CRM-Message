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
import { Loader2, Send, Trash2, UserPlus } from "lucide-react";

type Recipient = {
  id: string; whatsapp_number: string; full_name: string | null;
  last_status: string | null; last_error: string | null; last_sent_at: string | null;
  send_count: number; conversation_id: string | null;
};

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
  useEffect(() => { load(); }, [webinarId]);

  async function addRows(items: { phone: string; name: string }[]) {
    const clean = items.map((i) => ({ whatsapp_number: normalizeWa(i.phone), full_name: i.name.trim() || null }))
      .filter((i) => i.whatsapp_number);
    if (!clean.length) return toast.error("Tidak ada nomor valid");
    setBusy(true);
    const { error } = await supabase.from("webinar_blast_recipients" as any).upsert(
      clean.map((c) => ({ ...c, webinar_id: webinarId })) as any,
      { onConflict: "webinar_id,whatsapp_number" },
    );
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${clean.length} nomor disimpan`);
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

  async function removeSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    const { error } = await supabase.from("webinar_blast_recipients" as any).delete().in("id", ids);
    if (error) return toast.error(error.message);
    setSelected(new Set());
    load();
  }

  async function send() {
    const ids = [...selected];
    if (!ids.length) return toast.error("Pilih nomor dulu");
    if (!confirm(`Kirim template webinar ke ${ids.length} nomor?`)) return;
    setSending(true);
    try {
      const r = await blast({ data: { recipient_ids: ids } });
      toast.success(`Terkirim ${r.sent}, gagal ${r.failed}`);
      setSelected(new Set());
    } catch (e: any) {
      toast.error(e?.message || "Gagal blasting");
    }
    setSending(false);
    load();
  }

  const stats = useMemo(() => ({
    total: rows.length,
    sent: rows.filter((r) => r.last_status === "sent").length,
    failed: rows.filter((r) => r.last_status === "failed").length,
    fresh: rows.filter((r) => !chatted.has(r.whatsapp_number)).length,
  }), [rows, chatted]);

  const allChecked = rows.length > 0 && selected.size === rows.length;

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium mr-auto">Blasting Undangan (Template Webinar)</p>
        <Badge variant="secondary">Total {stats.total}</Badge>
        <Badge variant="secondary">Belum pernah chat {stats.fresh}</Badge>
        <Badge>Terkirim {stats.sent}</Badge>
        {stats.failed > 0 && <Badge variant="destructive">Gagal {stats.failed}</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">
        Pesan memakai template webinar dengan <b>{"{{1}}"}</b> = nama. Nomor yang sudah pernah chat masuk ke chat yang sama di Inbox; nomor baru otomatis dibuatkan chat baru.
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
        <Button variant="outline" size="sm" onClick={addBulk} disabled={busy || !bulk.trim()}>Simpan Daftar</Button>
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
        <Button size="sm" variant="ghost" onClick={removeSelected} disabled={!selected.size}>
          <Trash2 className="h-4 w-4 mr-1 text-destructive" /> Hapus
        </Button>
        <Button size="sm" className="ml-auto" onClick={send} disabled={sending || !selected.size}>
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
              <div className="text-xs text-muted-foreground">
                {r.whatsapp_number} · {chatted.has(r.whatsapp_number) ? "sudah pernah chat" : "belum pernah chat"}
              </div>
              {r.last_error && <div className="text-xs text-destructive truncate">{r.last_error}</div>}
            </div>
            {r.last_status === "sent" && <Badge>Terkirim{r.send_count > 1 ? ` ×${r.send_count}` : ""}</Badge>}
            {r.last_status === "failed" && <Badge variant="destructive">Gagal</Badge>}
          </label>
        ))}
      </div>
    </div>
  );
}
