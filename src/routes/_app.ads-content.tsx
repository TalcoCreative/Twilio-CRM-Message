import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { Plus, Trash2, Megaphone, Trophy, Copy, ExternalLink, Sparkles, CalendarRange, Eye, Users, X, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  AreaChart, Area, PieChart, Pie, Legend,
} from "recharts";

export const Route = createFileRoute("/_app/ads-content")({
  head: () => ({ meta: [{ title: "Ads Content — Husada CRM" }] }),
  component: AdsContentPage,
});

type ContentCode = {
  id: string; code: string; name: string;
  content_link: string | null; notes: string | null;
  product_id: string | null;
  is_active: boolean; created_at: string;
};
type LeadRow = {
  id: string; full_name: string | null; whatsapp_number: string;
  content_code_id: string | null; source: string | null;
  interested_product_id: string | null; created_at: string;
};
type Product = { id: string; name: string };

function toDateStr(d: Date) { return d.toISOString().slice(0, 10); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return toDateStr(d); }

function AdsContentPage() {
  const [codes, setCodes] = useState<ContentCode[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [bpjsContactIds, setBpjsContactIds] = useState<Set<string>>(new Set());
  const [openNew, setOpenNew] = useState(false);
  const [editing, setEditing] = useState<ContentCode | null>(null);
  const [form, setForm] = useState({ code: "", name: "", content_link: "", notes: "", product_id: "__none__", is_active: true });

  const [from, setFrom] = useState<string>(daysAgo(30));
  const [to, setTo] = useState<string>(toDateStr(new Date()));
  const [previewCodeId, setPreviewCodeId] = useState<string | null>(null);
  const [bpjsPreviewCodeId, setBpjsPreviewCodeId] = useState<string | null>(null);

  async function load() {
    const [c, l, p, bpjs] = await Promise.all([
      supabase.from("content_codes").select("*").order("created_at", { ascending: false }),
      supabase.from("contacts").select("id, full_name, whatsapp_number, content_code_id, source, interested_product_id, created_at").order("created_at", { ascending: false }).limit(5000),
      supabase.from("products").select("id, name").eq("is_active", true).order("sort_order"),
      supabase.from("messages").select("conversations!inner(contact_id)").ilike("content", "%bpjs%").limit(20000),
    ]);
    setCodes((c.data as any) || []);
    setLeads((l.data as any) || []);
    setProducts((p.data as any) || []);
    const bset = new Set<string>();
    ((bpjs.data as any[]) || []).forEach((m: any) => {
      const cid = m?.conversations?.contact_id;
      if (cid) bset.add(cid);
    });
    setBpjsContactIds(bset);
  }
  useEffect(() => {
    load();
    const ch = supabase.channel("ads-content-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "content_codes" }, () => load())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filteredLeads = useMemo(() => {
    const fromTs = new Date(from + "T00:00:00").getTime();
    const toTs = new Date(to + "T23:59:59").getTime();
    return leads.filter((l) => {
      const t = new Date(l.created_at).getTime();
      return t >= fromTs && t <= toTs;
    });
  }, [leads, from, to]);

  const stats = useMemo(() => {
    const byCode: Record<string, number> = {};
    let organik = 0, ads = 0, unassigned = 0;
    filteredLeads.forEach((l) => {
      if (l.content_code_id) { byCode[l.content_code_id] = (byCode[l.content_code_id] || 0) + 1; ads++; }
      else if ((l.source || "").toLowerCase() === "organik") organik++;
      else unassigned++;
    });
    return { byCode, organik, ads, unassigned, total: filteredLeads.length };
  }, [filteredLeads]);

  const ranked = useMemo(() => {
    return [...codes]
      .map((c) => ({ ...c, hits: stats.byCode[c.id] || 0 }))
      .sort((a, b) => b.hits - a.hits);
  }, [codes, stats]);

  // Daily series
  const daily = useMemo(() => {
    const days: Record<string, { day: string; ads: number; organik: number; total: number }> = {};
    const fromDate = new Date(from + "T00:00:00");
    const toDate = new Date(to + "T00:00:00");
    for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
      const k = toDateStr(d);
      days[k] = { day: k.slice(5), ads: 0, organik: 0, total: 0 };
    }
    filteredLeads.forEach((l) => {
      const k = l.created_at.slice(0, 10);
      if (!days[k]) return;
      days[k].total++;
      if (l.content_code_id) days[k].ads++;
      else if ((l.source || "").toLowerCase() === "organik") days[k].organik++;
    });
    return Object.values(days);
  }, [filteredLeads, from, to]);

  // Per product totals (based on interested_product_id of ads leads)
  const productTotals = useMemo(() => {
    const map: Record<string, number> = {};
    filteredLeads.forEach((l) => {
      if (!l.content_code_id) return;
      const k = l.interested_product_id || "__none__";
      map[k] = (map[k] || 0) + 1;
    });
    return Object.entries(map).map(([pid, count]) => ({
      name: pid === "__none__" ? "Tanpa Produk" : (products.find((p) => p.id === pid)?.name || "—"),
      value: count,
    })).sort((a, b) => b.value - a.value);
  }, [filteredLeads, products]);

  function openEdit(c: ContentCode) {
    setEditing(c);
    setForm({
      code: c.code, name: c.name,
      content_link: c.content_link || "", notes: c.notes || "",
      product_id: c.product_id || "__none__",
      is_active: c.is_active,
    });
    setOpenNew(true);
  }
  function openCreate() {
    setEditing(null);
    setForm({ code: "", name: "", content_link: "", notes: "", product_id: "__none__", is_active: true });
    setOpenNew(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      content_link: form.content_link.trim() || null,
      notes: form.notes.trim() || null,
      product_id: form.product_id === "__none__" ? null : form.product_id,
      is_active: form.is_active,
    };
    if (!payload.code || !payload.name) return toast.error("Kode & nama wajib diisi");
    const { error } = editing
      ? await supabase.from("content_codes").update(payload).eq("id", editing.id)
      : await supabase.from("content_codes").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Kode diperbarui" : "Kode ditambahkan");
    setOpenNew(false);
    load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("content_codes").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Kode dihapus");
    load();
  }

  const COLORS = ["#0ea5e9","#06b6d4","#14b8a6","#10b981","#84cc16","#f59e0b","#f97316","#ef4444","#a855f7","#8b5cf6"];
  const chartData = ranked.slice(0, 10).map((c) => ({ name: c.code, hits: c.hits }));

  const leadLog = useMemo(() => filteredLeads.slice(0, 200), [filteredLeads]);

  return (
    <div className="p-3 md:p-6 max-w-7xl mx-auto space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Megaphone className="size-6 text-primary" /> Ads Content Tracker</h1>
          <p className="text-sm text-muted-foreground">
            Deteksi konten yang menghasilkan leads paling banyak berdasarkan kode pembuka chat WhatsApp.
          </p>
        </div>
        <Button onClick={openCreate}><Plus className="size-4 mr-1.5" /> Kode Baru</Button>
      </header>

      {/* Date range filter */}
      <Card className="glow-soft">
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <CalendarRange className="size-4 text-muted-foreground" />
          <div className="flex items-center gap-1.5">
            <Label className="text-xs">Dari</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40" />
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="text-xs">Sampai</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-40" />
          </div>
          <div className="flex gap-1 ml-auto">
            <Button size="sm" variant="outline" onClick={() => { setFrom(daysAgo(6)); setTo(toDateStr(new Date())); }}>7 hari</Button>
            <Button size="sm" variant="outline" onClick={() => { setFrom(daysAgo(29)); setTo(toDateStr(new Date())); }}>30 hari</Button>
            <Button size="sm" variant="outline" onClick={() => { setFrom(daysAgo(89)); setTo(toDateStr(new Date())); }}>90 hari</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total Leads" value={stats.total} tone="primary" icon={<Sparkles className="size-4" />} />
        <Kpi label="Dari Ads" value={stats.ads} tone="emerald" />
        <Kpi label="Organik" value={stats.organik} tone="blue" />
        <Kpi label="Belum Terklasifikasi" value={stats.unassigned} tone="amber" />
      </div>

      {/* Semua infografis menurun (tanpa tabs) */}

      {/* Winning Content (Top 10) */}
      <Card className="glow-soft">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Trophy className="size-4 text-amber-500" /> Winning Content (Top 10 Kode)</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">Belum ada leads pada rentang tanggal ini.</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" style={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} style={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12, color: "hsl(var(--foreground))" }} />
                <Bar dataKey="hits" radius={[6, 6, 0, 0]}>
                  {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Konten apa dapet berapa leads */}
      <Card className="glow-soft">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Megaphone className="size-4 text-primary" /> Konten & Jumlah Leads</CardTitle>
        </CardHeader>
        <CardContent>
          {ranked.filter((r) => r.hits > 0).length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">Belum ada konten yang menghasilkan leads pada rentang ini.</div>
          ) : (
            <div className="space-y-2">
              {(() => {
                const maxHits = Math.max(...ranked.map((r) => r.hits), 1);
                return ranked.filter((r) => r.hits > 0).map((r, i) => (
                  <button
                    key={r.id}
                    onClick={() => setPreviewCodeId(r.id)}
                    className="w-full text-left p-3 rounded-lg bg-accent/40 border border-border/50 hover:bg-accent/70 hover:border-primary/40 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="font-medium truncate">{r.name}</div>
                          {r.content_link && (
                            <a
                              href={r.content_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                              title="Buka link konten"
                            >
                              <ExternalLink className="size-3.5" />
                            </a>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">{r.code}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-2xl font-bold" style={{ color: COLORS[i % COLORS.length] }}>
                          {r.hits}
                          <span className="text-xs text-muted-foreground font-normal ml-1">leads</span>
                        </div>
                        <Eye className="size-4 text-muted-foreground" />
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${(r.hits / maxHits) * 100}%`, background: COLORS[i % COLORS.length] }} />
                    </div>
                  </button>
                ));
              })()}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview Dialog */}
      <Dialog open={!!previewCodeId} onOpenChange={(v) => !v && setPreviewCodeId(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Users className="size-5 text-primary" />
              Preview Leads — {codes.find((c) => c.id === previewCodeId)?.name || "Konten"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto mt-2">
            {(() => {
              const code = codes.find((c) => c.id === previewCodeId);
              const codeLeads = filteredLeads.filter((l) => l.content_code_id === previewCodeId);
              if (!code) return null;
              if (codeLeads.length === 0) {
                return <div className="text-center text-sm text-muted-foreground py-8">Belum ada leads untuk konten ini.</div>;
              }
              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted text-muted-foreground sticky top-0">
                      <tr>
                        <th className="text-left p-2.5 font-medium">Waktu</th>
                        <th className="text-left p-2.5 font-medium">Nama</th>
                        <th className="text-left p-2.5 font-medium">Nomor</th>
                        <th className="text-left p-2.5 font-medium">Produk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {codeLeads.map((l) => {
                        const prod = products.find((p) => p.id === l.interested_product_id);
                        return (
                          <tr key={l.id} className="border-t hover:bg-accent/40">
                            <td className="p-2.5 text-xs">{new Date(l.created_at).toLocaleString("id-ID")}</td>
                            <td className="p-2.5">{l.full_name || "—"}</td>
                            <td className="p-2.5 font-mono text-xs">{l.whatsapp_number}</td>
                            <td className="p-2.5 text-xs">{prod?.name || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Tren Harian */}
      <Card className="glow-soft">
        <CardHeader className="pb-2"><CardTitle className="text-base">Tren Harian</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={daily}>
              <defs>
                <linearGradient id="gAds" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gOrg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="day" style={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} style={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12, color: "hsl(var(--foreground))" }} />
              <Legend />
              <Area type="monotone" dataKey="ads" stroke="#10b981" fill="url(#gAds)" name="Ads" />
              <Area type="monotone" dataKey="organik" stroke="#0ea5e9" fill="url(#gOrg)" name="Organik" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Distribusi Produk */}
      <Card className="glow-soft">
        <CardHeader className="pb-2"><CardTitle className="text-base">Distribusi Produk (dari Ads)</CardTitle></CardHeader>
        <CardContent>
          {productTotals.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">Belum ada leads ads pada rentang ini.</div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4 items-center">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={productTotals} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                    {productTotals.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12, color: "hsl(var(--foreground))" }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5">
                {productTotals.map((p, i) => (
                  <div key={p.name} className="flex items-center justify-between text-sm p-2 rounded-lg bg-accent/40">
                    <div className="flex items-center gap-2">
                      <span className="size-3 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      <span>{p.name}</span>
                    </div>
                    <span className="font-bold">{p.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Daftar Kode */}
      <Card className="glow-soft overflow-hidden">
        <CardHeader className="pb-2"><CardTitle className="text-base">Daftar Kode Konten</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="text-left p-3 font-medium">Kode</th>
                  <th className="text-left p-3 font-medium">Nama</th>
                  <th className="text-left p-3 font-medium">Produk</th>
                  <th className="text-left p-3 font-medium">Link</th>
                  <th className="text-right p-3 font-medium">Leads</th>
                  <th className="text-center p-3 font-medium">Status</th>
                  <th className="p-3 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((c) => (
                  <tr key={c.id} className="border-t hover:bg-accent/40">
                    <td className="p-3">
                      <button onClick={() => { navigator.clipboard.writeText(c.code); toast.success(`Kode "${c.code}" disalin`); }}
                        className="font-mono font-semibold text-primary hover:underline inline-flex items-center gap-1">
                        {c.code} <Copy className="size-3 opacity-60" />
                      </button>
                    </td>
                    <td className="p-3">
                      <button className="hover:text-primary text-left" onClick={() => openEdit(c)}>{c.name}</button>
                      {c.notes && <div className="text-xs text-muted-foreground line-clamp-1">{c.notes}</div>}
                    </td>
                    <td className="p-3 text-xs">
                      {c.product_id
                        ? <Badge variant="outline" className="border-primary/30 text-primary">{products.find((p) => p.id === c.product_id)?.name || "—"}</Badge>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-3">
                      {c.content_link
                        ? <a href={c.content_link} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1 hover:underline"><ExternalLink className="size-3" /> Buka</a>
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="p-3 text-right font-bold text-lg">{c.hits}</td>
                    <td className="p-3 text-center">
                      {c.is_active
                        ? <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">Aktif</Badge>
                        : <Badge variant="outline">Nonaktif</Badge>}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>Edit</Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" className="text-destructive"><Trash2 className="size-4" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Hapus kode "{c.code}"?</AlertDialogTitle>
                              <AlertDialogDescription>Leads yang terhubung akan kehilangan referensi konten (source tetap "ads").</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Batal</AlertDialogCancel>
                              <AlertDialogAction onClick={() => remove(c.id)}>Hapus</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </td>
                  </tr>
                ))}
                {ranked.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Belum ada kode. Tambahkan kode pertama untuk mulai tracking.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Log Leads */}
      <Card className="glow-soft overflow-hidden">
        <CardHeader className="pb-2"><CardTitle className="text-base">Log Leads Masuk ({leadLog.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left p-2.5 font-medium">Waktu</th>
                  <th className="text-left p-2.5 font-medium">Nama</th>
                  <th className="text-left p-2.5 font-medium">Nomor</th>
                  <th className="text-left p-2.5 font-medium">Sumber</th>
                  <th className="text-left p-2.5 font-medium">Kode</th>
                  <th className="text-left p-2.5 font-medium">Produk</th>
                </tr>
              </thead>
              <tbody>
                {leadLog.map((l) => {
                  const code = codes.find((c) => c.id === l.content_code_id);
                  const prod = products.find((p) => p.id === l.interested_product_id);
                  return (
                    <tr key={l.id} className="border-t hover:bg-accent/40">
                      <td className="p-2.5 text-xs">{new Date(l.created_at).toLocaleString("id-ID")}</td>
                      <td className="p-2.5">{l.full_name || "—"}</td>
                      <td className="p-2.5 font-mono text-xs">{l.whatsapp_number}</td>
                      <td className="p-2.5">
                        {l.content_code_id
                          ? <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">Ads</Badge>
                          : (l.source === "organik" ? <Badge variant="outline">Organik</Badge> : <Badge variant="secondary">—</Badge>)}
                      </td>
                      <td className="p-2.5 font-mono text-xs">{code?.code || "—"}</td>
                      <td className="p-2.5 text-xs">{prod?.name || "—"}</td>
                    </tr>
                  );
                })}
                {leadLog.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Tidak ada leads pada rentang ini.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>


      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Kode Konten" : "Kode Konten Baru"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Kode <span className="text-muted-foreground text-xs">(mis. IG001, TIKTOK-A, FB-MCU)</span></Label>
              <Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="IG001" className="font-mono uppercase" />
              <p className="text-[11px] text-muted-foreground">
                Sistem akan menganggap leads sebagai "ads" jika pesan pertama mereka mengandung kode ini.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Nama Konten</Label>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Instagram Reels — Medical Check Up Juni" />
            </div>
            <div className="space-y-1.5">
              <Label>Produk Terkait <span className="text-muted-foreground text-xs">(otomatis ke-assign ke Leads)</span></Label>
              <Select value={form.product_id} onValueChange={(v) => setForm({ ...form, product_id: v })}>
                <SelectTrigger><SelectValue placeholder="Pilih produk" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Tanpa produk</SelectItem>
                  {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Link Konten (opsional)</Label>
              <Input value={form.content_link} onChange={(e) => setForm({ ...form, content_link: e.target.value })}
                placeholder="https://instagram.com/reel/..." />
            </div>
            <div className="space-y-1.5">
              <Label>Catatan</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Copywriter: Aura. Anggaran: Rp 2jt." />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">Aktif</div>
                <div className="text-xs text-muted-foreground">Nonaktifkan untuk berhenti mendeteksi kode ini.</div>
              </div>
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpenNew(false)}>Batal</Button>
              <Button type="submit">{editing ? "Simpan" : "Tambah"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({ label, value, tone, icon }: { label: string; value: number; tone: "primary" | "emerald" | "blue" | "amber"; icon?: React.ReactNode }) {
  const tones: Record<string, string> = {
    primary: "from-primary/20 to-primary/5 text-primary",
    emerald: "from-emerald-500/20 to-emerald-500/5 text-emerald-600 dark:text-emerald-400",
    blue: "from-blue-500/20 to-blue-500/5 text-blue-600 dark:text-blue-400",
    amber: "from-amber-500/20 to-amber-500/5 text-amber-600 dark:text-amber-400",
  };
  return (
    <Card className={`glow-soft bg-gradient-to-br ${tones[tone]}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-xs font-medium opacity-80">{icon} {label}</div>
        <div className="text-3xl font-bold mt-1">{value.toLocaleString("id-ID")}</div>
      </CardContent>
    </Card>
  );
}
