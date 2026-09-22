import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Video, Users } from "lucide-react";

type Webinar = {
  id: string;
  name: string;
  code: string;
  zoom_link: string;
  message_template: string;
  is_active: boolean;
  stop_chatbot: boolean;
  created_at: string;
};

const DEFAULT_TEMPLATE = `Terima kasih sudah mendaftar {{webinar}} 🙏

Berikut link Zoom Meeting-nya:
{{link}}

Simpan pesan ini ya, sampai jumpa di acara!`;

export function WebinarTab() {
  const [items, setItems] = useState<Webinar[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    const { data, error } = await supabase
      .from("webinars").select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setItems((data as Webinar[]) || []);
    const { data: regs } = await supabase.from("webinar_registrations").select("webinar_id");
    const c: Record<string, number> = {};
    (regs || []).forEach((r: any) => { c[r.webinar_id] = (c[r.webinar_id] || 0) + 1; });
    setCounts(c);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addWebinar() {
    setCreating(true);
    const { error } = await supabase.from("webinars").insert({
      name: "Webinar Baru",
      code: `WEBINAR${Math.floor(Math.random() * 900 + 100)}`,
      zoom_link: "",
      message_template: DEFAULT_TEMPLATE,
      is_active: true,
      stop_chatbot: true,
    });
    setCreating(false);
    if (error) return toast.error(error.message);
    toast.success("Webinar ditambahkan");
    load();
  }

  function patch(id: string, p: Partial<Webinar>) {
    setItems((prev) => prev.map((w) => (w.id === id ? { ...w, ...p } : w)));
  }

  async function save(w: Webinar) {
    if (!w.code.trim()) return toast.error("Kode webinar wajib diisi");
    setSavingId(w.id);
    const { error } = await supabase.from("webinars").update({
      name: w.name.trim() || "Webinar",
      code: w.code.trim(),
      zoom_link: w.zoom_link.trim(),
      message_template: w.message_template,
      is_active: w.is_active,
      stop_chatbot: w.stop_chatbot,
    }).eq("id", w.id);
    setSavingId(null);
    if (error) return toast.error(error.message.includes("unique") ? "Kode sudah dipakai webinar lain" : error.message);
    toast.success("Tersimpan");
  }

  async function remove(id: string) {
    const { error } = await supabase.from("webinars").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Webinar dihapus");
    load();
  }

  function preview(w: Webinar) {
    return w.message_template
      .replaceAll("{{link}}", w.zoom_link || "(link belum diisi)")
      .replaceAll("{{webinar}}", w.name)
      .replaceAll("{{nama}}", "Budi")
      .replaceAll("{{kode}}", w.code);
  }

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Video className="h-4 w-4" /> Webinar & Link Zoom</CardTitle>
          <CardDescription>
            Kalau pasien mengirim salah satu kode di bawah, chatbot biasa tidak jalan — sistem langsung membalas
            dengan pesan terima kasih dan link Zoom sesuai teks yang kamu tulis (spasi dan enter dipertahankan persis).
            <br />Kata kunci yang bisa dipakai di teks: <b>{"{{link}}"}</b>, <b>{"{{webinar}}"}</b>, <b>{"{{nama}}"}</b>, <b>{"{{kode}}"}</b>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={addWebinar} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Tambah Webinar
          </Button>
        </CardContent>
      </Card>

      {items.length === 0 && (
        <p className="text-sm text-muted-foreground px-1">Belum ada webinar. Klik "Tambah Webinar" untuk mulai.</p>
      )}

      {items.map((w) => (
        <Card key={w.id}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                {w.name}
                <Badge variant={w.is_active ? "default" : "secondary"}>{w.is_active ? "Aktif" : "Nonaktif"}</Badge>
                <span className="text-xs font-normal text-muted-foreground inline-flex items-center gap-1">
                  <Users className="h-3 w-3" /> {counts[w.id] || 0} pendaftar
                </span>
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => remove(w.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Nama Webinar</Label>
                <Input value={w.name} onChange={(e) => patch(w.id, { name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Kode Pendaftaran</Label>
                <Input value={w.code} onChange={(e) => patch(w.id, { code: e.target.value })} placeholder="WEBINARJANTUNG" />
              </div>
              <div className="space-y-1.5">
                <Label>Link Zoom Meeting</Label>
                <Input value={w.zoom_link} onChange={(e) => patch(w.id, { zoom_link: e.target.value })} placeholder="https://zoom.us/j/..." />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Isi Pesan Balasan</Label>
              <Textarea
                value={w.message_template}
                onChange={(e) => patch(w.id, { message_template: e.target.value })}
                rows={9}
                className="font-mono text-xs whitespace-pre-wrap"
              />
              <p className="text-xs text-muted-foreground">Enter dan spasi kosong dikirim persis seperti yang kamu tulis di sini.</p>
            </div>

            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs font-medium mb-1.5 text-muted-foreground">Pratinjau pesan yang dikirim</p>
              <pre className="whitespace-pre-wrap break-words text-sm font-sans">{preview(w)}</pre>
            </div>

            <div className="flex flex-wrap items-center gap-5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={w.is_active} onChange={(e) => patch(w.id, { is_active: e.target.checked })} />
                Aktifkan kode ini
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={w.stop_chatbot} onChange={(e) => patch(w.id, { stop_chatbot: e.target.checked })} />
                Hentikan chatbot biasa untuk pasien ini
              </label>
              <Button className="ml-auto" onClick={() => save(w)} disabled={savingId === w.id}>
                {savingId === w.id && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Simpan
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
