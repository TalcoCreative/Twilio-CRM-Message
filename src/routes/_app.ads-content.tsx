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

import { Plus, Trash2, Megaphone, Trophy, Copy, ExternalLink, Sparkles, CalendarRange, Eye, Users, X, ShieldCheck, Download } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  AreaChart, Area, PieChart, Pie, Legend, ComposedChart, Line,
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

/** Kategori BPJS mencakup penyebutan BPJS, KIS, atau ASKES pada chat. */
const BPJS_KEYWORD_RE = /\b(bpjs|kis|askes)\b/i;

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

  const [loading, setLoading] = useState(true);

  /** Ambil semua baris tanpa batas 1000 (paginasi otomatis). */
  async function fetchAllRows(build: (from: number, to: number) => any) {
    const pageSize = 1000;
    const rows: any[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await build(from, from + pageSize - 1);
      if (error) break;
      const chunk = (data as any[]) || [];
      rows.push(...chunk);
      if (chunk.length < pageSize) break;
    }
    return rows;
  }

  async function loadBase() {
    const [c, l, p] = await Promise.all([
      supabase.from("content_codes").select("*").order("created_at", { ascending: false }),
      fetchAllRows((f, t) =>
        supabase
          .from("contacts")
          .select("id, full_name, whatsapp_number, content_code_id, source, interested_product_id, created_at")
          .order("created_at", { ascending: false })
          .range(f, t),
      ),
      supabase.from("products").select("id, name").eq("is_active", true).order("sort_order"),
    ]);
    setCodes((c.data as any) || []);
    setLeads((l as any) || []);
    setProducts((p.data as any) || []);
  }

  async function loadBpjs() {
    const data = await fetchAllRows((f, t) =>
      supabase
        .from("messages")
        .select("content, conversations!inner(contact_id)")
        .or("content.ilike.%bpjs%,content.ilike.%kis%,content.ilike.%askes%")
        .order("created_at", { ascending: false })
        .range(f, t),
    );
    const bset = new Set<string>();
    (data || []).forEach((m: any) => {
      const cid = m?.conversations?.contact_id;
      if (cid && BPJS_KEYWORD_RE.test(String(m?.content || ""))) bset.add(cid);
    });
    setBpjsContactIds(bset);
  }


  useEffect(() => {
    // Render tabel/kode secepatnya, data BPJS (query berat) menyusul di background
    loadBase().finally(() => setLoading(false));
    loadBpjs();

    let baseTimer: any, bpjsTimer: any;
    const queueBase = () => { clearTimeout(baseTimer); baseTimer = setTimeout(loadBase, 800); };
    const queueBpjs = () => { clearTimeout(bpjsTimer); bpjsTimer = setTimeout(loadBpjs, 3000); };

    const ch = supabase.channel("ads-content-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts" }, queueBase)
      .on("postgres_changes", { event: "*", schema: "public", table: "content_codes" }, queueBase)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload: any) => {
        // Hanya refresh kalau pesannya menyebut BPJS / KIS / ASKES
        const content = String(payload?.new?.content || "");
        if (BPJS_KEYWORD_RE.test(content)) queueBpjs();
      })

      .subscribe();
    return () => { clearTimeout(baseTimer); clearTimeout(bpjsTimer); supabase.removeChannel(ch); };
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

  // BPJS detection per content code
  const bpjsByCode = useMemo(() => {
    const map: Record<string, { total: number; bpjs: number; bpjsLeads: LeadRow[]; nonBpjsLeads: LeadRow[] }> = {};
    filteredLeads.forEach((l) => {
      if (!l.content_code_id) return;
      const cid = l.content_code_id;
      if (!map[cid]) map[cid] = { total: 0, bpjs: 0, bpjsLeads: [], nonBpjsLeads: [] };
      map[cid].total++;
      if (bpjsContactIds.has(l.id)) {
        map[cid].bpjs++;
        map[cid].bpjsLeads.push(l);
      } else {
        map[cid].nonBpjsLeads.push(l);
      }
    });
    return map;
  }, [filteredLeads, bpjsContactIds]);

  const bpjsRanked = useMemo(() => {
    return codes
      .map((c) => {
        const s = bpjsByCode[c.id] || { total: 0, bpjs: 0, bpjsLeads: [], nonBpjsLeads: [] };
        const pct = s.total > 0 ? Math.round((s.bpjs / s.total) * 100) : 0;
        return { ...c, ...s, pct };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.pct - a.pct || b.bpjs - a.bpjs);
  }, [codes, bpjsByCode]);

  // Jumlah BPJS per tanggal (mengikuti filter tanggal)
  const bpjsDaily = useMemo(() => {
    const map: Record<string, { day: string; total: number; bpjs: number }> = {};
    filteredLeads.forEach((l) => {
      const k = l.created_at.slice(0, 10);
      if (!map[k]) map[k] = { day: k, total: 0, bpjs: 0 };
      map[k].total++;
      if (bpjsContactIds.has(l.id)) map[k].bpjs++;
    });
    return Object.values(map)
      .map((r) => ({ ...r, nonBpjs: r.total - r.bpjs, pct: r.total ? Math.round((r.bpjs / r.total) * 100) : 0 }))
      .sort((a, b) => (a.day < b.day ? 1 : -1));
  }, [filteredLeads, bpjsContactIds]);

  const bpjsDailyTotals = useMemo(() => {
    const total = bpjsDaily.reduce((a, b) => a + b.total, 0);
    const bpjs = bpjsDaily.reduce((a, b) => a + b.bpjs, 0);
    return { total, bpjs, nonBpjs: total - bpjs, pct: total ? Math.round((bpjs / total) * 100) : 0 };
  }, [bpjsDaily]);

  // Ascending (kronologis) + kumulatif & moving average 7 hari untuk grafik tren
  const bpjsDailyAsc = useMemo(() => {
    const asc = [...bpjsDaily].sort((a, b) => (a.day < b.day ? -1 : 1));
    let cumTotal = 0;
    let cumBpjs = 0;
    return asc.map((r, i) => {
      cumTotal += r.total;
      cumBpjs += r.bpjs;
      const win = asc.slice(Math.max(0, i - 6), i + 1);
      const wt = win.reduce((a, b) => a + b.total, 0);
      const wb = win.reduce((a, b) => a + b.bpjs, 0);
      return {
        ...r,
        label: r.day.slice(5),
        cumTotal,
        cumBpjs,
        cumPct: cumTotal ? Math.round((cumBpjs / cumTotal) * 100) : 0,
        ma7: wt ? Math.round((wb / wt) * 100) : 0,
      };
    });
  }, [bpjsDaily]);




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
    loadBase();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("content_codes").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Kode dihapus");
    loadBase();
  }

  const COLORS = ["#0ea5e9","#06b6d4","#14b8a6","#10b981","#84cc16","#f59e0b","#f97316","#ef4444","#a855f7","#8b5cf6"];
  const chartData = ranked.slice(0, 10).map((c) => ({ name: c.code, hits: c.hits }));

  const leadLog = filteredLeads;

  function exportXlsx() {
    try {
      const wb = XLSX.utils.book_new();
      const fmtDate = (s: string) => new Date(s).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
      const codeById = (id: string | null) => codes.find((c) => c.id === id);
      const prodById = (id: string | null) => products.find((p) => p.id === id);

      // Sheet 1: Ringkasan
      const summary = [
        ["Ads Content Tracker — Ringkasan Export"],
        ["Rentang", `${from} s/d ${to}`],
        ["Dibuat", new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })],
        [],
        ["Total Leads", stats.total],
        ["Dari Ads", stats.ads],
        ["Organik", stats.organik],
        ["Belum Terklasifikasi", stats.unassigned],
        ["Total Kode Konten Aktif", codes.filter((c) => c.is_active).length],
        ["Total Kode Konten", codes.length],
        ["Total Leads Menyebut BPJS (Ads)", bpjsRanked.reduce((a, b) => a + b.bpjs, 0)],
        [],
        ["BPJS — Seluruh Leads (rentang aktif)"],
        ["Total Leads", bpjsDailyTotals.total],
        ["Leads BPJS", bpjsDailyTotals.bpjs],
        ["Leads Non-BPJS", bpjsDailyTotals.nonBpjs],
        ["Persentase BPJS (%)", bpjsDailyTotals.pct],
        ["Hari Tertinggi BPJS", (() => { const m = [...bpjsDaily].sort((a, b) => b.bpjs - a.bpjs)[0]; return m ? `${m.day} (${m.bpjs} leads, ${m.pct}%)` : "—"; })()],
        ["Rata-rata BPJS / Hari", bpjsDaily.length ? Math.round((bpjsDailyTotals.bpjs / bpjsDaily.length) * 10) / 10 : 0],
      ];
      const wsSum = XLSX.utils.aoa_to_sheet(summary);
      wsSum["!cols"] = [{ wch: 40 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, wsSum, "Ringkasan");

      // Sheet 2: Konten & Jumlah Leads (ranked)
      const rankRows = ranked.map((c, i) => ({
        Rank: i + 1,
        Kode: c.code,
        Nama: c.name,
        Produk: prodById(c.product_id)?.name || "—",
        "Jumlah Leads": c.hits,
        "Link Konten": c.content_link || "",
        Catatan: c.notes || "",
        Aktif: c.is_active ? "Ya" : "Tidak",
        "Dibuat": fmtDate(c.created_at),
      }));
      const wsRank = XLSX.utils.json_to_sheet(rankRows);
      wsRank["!cols"] = [{ wch: 6 }, { wch: 14 }, { wch: 40 }, { wch: 24 }, { wch: 14 }, { wch: 50 }, { wch: 40 }, { wch: 8 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(wb, wsRank, "Konten & Leads");

      // Sheet 3: BPJS Detected per Konten
      const bpjsRows = bpjsRanked.map((r) => ({
        Kode: r.code,
        Nama: r.name,
        "Total Leads": r.total,
        "Leads Menyebut BPJS": r.bpjs,
        "Persentase BPJS (%)": r.pct,
        "Non-BPJS": r.total - r.bpjs,
        "Link Konten": r.content_link || "",
      }));
      const wsBpjs = XLSX.utils.json_to_sheet(bpjsRows);
      wsBpjs["!cols"] = [{ wch: 14 }, { wch: 40 }, { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 12 }, { wch: 50 }];
      XLSX.utils.book_append_sheet(wb, wsBpjs, "BPJS Detected");

      // Sheet 3b: Jumlah BPJS per Tanggal (kronologis + kumulatif + MA7)
      const dayName = (d: string) =>
        new Date(d + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", timeZone: "Asia/Jakarta" });
      const bpjsDailyRows = [
        ...bpjsDailyAsc.map((r) => ({
          Tanggal: r.day,
          Hari: dayName(r.day),
          "Total Leads": r.total,
          BPJS: r.bpjs,
          "Non-BPJS": r.nonBpjs,
          "Persentase BPJS (%)": r.pct,
          "MA 7 Hari (%)": r.ma7,
          "Kumulatif Leads": r.cumTotal,
          "Kumulatif BPJS": r.cumBpjs,
          "Kumulatif % BPJS": r.cumPct,
        })),
        {
          Tanggal: "TOTAL",
          Hari: "",
          "Total Leads": bpjsDailyTotals.total,
          BPJS: bpjsDailyTotals.bpjs,
          "Non-BPJS": bpjsDailyTotals.nonBpjs,
          "Persentase BPJS (%)": bpjsDailyTotals.pct,
          "MA 7 Hari (%)": "",
          "Kumulatif Leads": bpjsDailyTotals.total,
          "Kumulatif BPJS": bpjsDailyTotals.bpjs,
          "Kumulatif % BPJS": bpjsDailyTotals.pct,
        },
      ];
      const wsBpjsDaily = XLSX.utils.json_to_sheet(bpjsDailyRows);
      wsBpjsDaily["!cols"] = [{ wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, wsBpjsDaily, "BPJS Harian");

      // Sheet 3c: Detail leads BPJS per tanggal
      const bpjsDetailRows = filteredLeads
        .filter((l) => bpjsContactIds.has(l.id))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .map((l) => {
          const c = codeById(l.content_code_id);
          return {
            Tanggal: l.created_at.slice(0, 10),
            Waktu: fmtDate(l.created_at),
            Nama: l.full_name || "",
            "No WhatsApp": l.whatsapp_number,
            Sumber: l.content_code_id ? "Ads" : (l.source === "organik" ? "Organik" : "—"),
            "Kode Konten": c?.code || "",
            "Nama Konten": c?.name || "",
            "Link Konten": c?.content_link || "",
            Produk: prodById(l.interested_product_id)?.name || "",
          };
        });
      const wsBpjsDetail = XLSX.utils.json_to_sheet(
        bpjsDetailRows.length ? bpjsDetailRows : [{ Tanggal: "", Waktu: "", Nama: "Tidak ada leads BPJS pada rentang ini" }]
      );
      wsBpjsDetail["!cols"] = [{ wch: 12 }, { wch: 22 }, { wch: 26 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 36 }, { wch: 50 }, { wch: 24 }];
      XLSX.utils.book_append_sheet(wb, wsBpjsDetail, "BPJS Detail Leads");


      // Sheet 4: Distribusi Produk (Ads)
      const prodRows = productTotals.map((p) => ({ Produk: p.name, "Jumlah Leads Ads": p.value }));
      const wsProd = XLSX.utils.json_to_sheet(prodRows);
      wsProd["!cols"] = [{ wch: 32 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, wsProd, "Distribusi Produk");

      // Sheet 5: Tren Harian
      const dailyRows = daily.map((d) => ({ Tanggal: d.day, Ads: d.ads, Organik: d.organik, Total: d.total }));
      const wsDaily = XLSX.utils.json_to_sheet(dailyRows);
      wsDaily["!cols"] = [{ wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 8 }];
      XLSX.utils.book_append_sheet(wb, wsDaily, "Tren Harian");

      // Sheet 6: Log Leads Lengkap
      const logRows = filteredLeads.map((l) => {
        const c = codeById(l.content_code_id);
        return {
          Waktu: fmtDate(l.created_at),
          Nama: l.full_name || "",
          "No WhatsApp": l.whatsapp_number,
          Sumber: l.content_code_id ? "Ads" : (l.source === "organik" ? "Organik" : "—"),
          "Kode Konten": c?.code || "",
          "Nama Konten": c?.name || "",
          "Link Konten": c?.content_link || "",
          Produk: prodById(l.interested_product_id)?.name || "",
          "BPJS Terdeteksi": bpjsContactIds.has(l.id) ? "Ya" : "Tidak",
        };
      });
      const wsLog = XLSX.utils.json_to_sheet(logRows);
      wsLog["!cols"] = [{ wch: 22 }, { wch: 26 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 36 }, { wch: 50 }, { wch: 24 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, wsLog, "Log Leads");

      const fname = `ads-content-${from}_to_${to}.xlsx`;
      XLSX.writeFile(wb, fname);
      toast.success(`Exported ${fname}`);
    } catch (e: any) {
      toast.error("Export gagal: " + (e?.message || String(e)));
    }
  }

  return (
    <div className="p-3 md:p-6 max-w-7xl mx-auto space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Megaphone className="size-6 text-primary" /> Ads Content Tracker</h1>
          <p className="text-sm text-muted-foreground">
            Deteksi konten yang menghasilkan leads paling banyak berdasarkan kode pembuka chat WhatsApp.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportXlsx}><Download className="size-4 mr-1.5" /> Export XLSX</Button>
          <Button onClick={openCreate}><Plus className="size-4 mr-1.5" /> Kode Baru</Button>
        </div>
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

      {/* BPJS Detected */}
      <Card className="glow-soft">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="size-4 text-emerald-500" /> BPJS Detected per Konten
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Persentase leads dari tiap kode konten yang menyebut keyword kategori BPJS — <b>BPJS</b>, <b>KIS</b>, atau <b>ASKES</b> — pada percakapan mereka (dibaca dari seluruh isi chat). Klik untuk melihat siapa saja yang terdeteksi.
          </p>
        </CardHeader>
        <CardContent>
          {bpjsRanked.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">Belum ada leads ads pada rentang ini.</div>
          ) : (
            <div className="space-y-2">
              {bpjsRanked.map((r, i) => (
                <button
                  key={r.id}
                  onClick={() => setBpjsPreviewCodeId(r.id)}
                  disabled={r.bpjs === 0}
                  className="w-full text-left p-3 rounded-lg bg-accent/40 border border-border/50 hover:bg-accent/70 hover:border-emerald-500/40 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-medium truncate">{r.name}</div>
                        <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400 shrink-0">
                          BPJS Detected
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">{r.code}</div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{r.pct}%</div>
                        <div className="text-[11px] text-muted-foreground">{r.bpjs} dari {r.total} leads</div>
                      </div>
                      <Eye className="size-4 text-muted-foreground" />
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${r.pct}%` }} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Jumlah BPJS per Tanggal */}
      <Card className="glow-soft">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="size-4 text-emerald-500" /> Jumlah BPJS per Tanggal
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Total leads yang menyebut keyword kategori BPJS (<b>BPJS</b> / <b>KIS</b> / <b>ASKES</b>) per tanggal — seluruh leads, bukan per konten — sesuai filter tanggal aktif.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-lg bg-accent/40 border border-border/50">
              <div className="text-xs text-muted-foreground">Total Leads</div>
              <div className="text-2xl font-bold">{bpjsDailyTotals.total}</div>
            </div>
            <div className="p-3 rounded-lg bg-accent/40 border border-border/50">
              <div className="text-xs text-muted-foreground">BPJS</div>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{bpjsDailyTotals.bpjs}</div>
            </div>
            <div className="p-3 rounded-lg bg-accent/40 border border-border/50">
              <div className="text-xs text-muted-foreground">Non-BPJS</div>
              <div className="text-2xl font-bold">{bpjsDailyTotals.nonBpjs}</div>
            </div>
            <div className="p-3 rounded-lg bg-accent/40 border border-border/50">
              <div className="text-xs text-muted-foreground">Persentase BPJS</div>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{bpjsDailyTotals.pct}%</div>
            </div>
          </div>
          {bpjsDailyAsc.length > 0 && (
            <div className="mb-4 rounded-lg border border-border/50 p-3">
              <div className="text-xs text-muted-foreground mb-2">
                Tren harian: batang = jumlah leads (BPJS vs Non-BPJS), garis = % BPJS harian dan rata-rata bergerak 7 hari.
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={bpjsDailyAsc}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis yAxisId="left" fontSize={11} allowDecimals={false} />
                  <YAxis yAxisId="right" orientation="right" fontSize={11} domain={[0, 100]} unit="%" />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: any, n: any) => [String(v) + (String(n).includes("%") ? "%" : ""), n]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="bpjs" name="BPJS" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                  <Bar yAxisId="left" dataKey="nonBpjs" name="Non-BPJS" stackId="a" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="pct" name="% BPJS" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="ma7" name="% BPJS (MA 7 hari)" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 3" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          {bpjsDaily.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">Belum ada leads pada rentang ini.</div>
          ) : (
            <div className="max-h-[420px] overflow-auto rounded-lg border border-border/50">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border/50 text-xs text-muted-foreground">
                    <th className="text-left p-2 font-medium">Tanggal</th>
                    <th className="text-right p-2 font-medium">Total Leads</th>
                    <th className="text-right p-2 font-medium">BPJS</th>
                    <th className="text-right p-2 font-medium">Non-BPJS</th>
                    <th className="text-right p-2 font-medium">% BPJS</th>
                  </tr>
                </thead>
                <tbody>
                  {bpjsDaily.map((r) => (
                    <tr key={r.day} className="border-b border-border/30 last:border-0">
                      <td className="p-2 font-mono text-xs">{r.day}</td>
                      <td className="p-2 text-right">{r.total}</td>
                      <td className="p-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">{r.bpjs}</td>
                      <td className="p-2 text-right">{r.nonBpjs}</td>
                      <td className="p-2 text-right">{r.pct}%</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-accent/40 font-semibold">
                    <td className="p-2">Total</td>
                    <td className="p-2 text-right">{bpjsDailyTotals.total}</td>
                    <td className="p-2 text-right text-emerald-600 dark:text-emerald-400">{bpjsDailyTotals.bpjs}</td>
                    <td className="p-2 text-right">{bpjsDailyTotals.nonBpjs}</td>
                    <td className="p-2 text-right">{bpjsDailyTotals.pct}%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>



      {/* BPJS Preview Dialog — hanya menampilkan leads yang menyebut BPJS */}
      <Dialog open={!!bpjsPreviewCodeId} onOpenChange={(v) => !v && setBpjsPreviewCodeId(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-emerald-500" />
              Leads BPJS — {codes.find((c) => c.id === bpjsPreviewCodeId)?.name || "Konten"}
            </DialogTitle>
            {bpjsPreviewCodeId && (() => {
              const s = bpjsByCode[bpjsPreviewCodeId];
              if (!s) return null;
              return (
                <p className="text-xs text-muted-foreground">
                  {s.bpjs} dari {s.total} leads ({s.total ? Math.round((s.bpjs / s.total) * 100) : 0}%) menyebut keyword BPJS / KIS / ASKES.
                </p>
              );
            })()}
          </DialogHeader>
          <div className="flex-1 overflow-auto mt-2">
            {(() => {
              const s = bpjsByCode[bpjsPreviewCodeId || ""];
              if (!s || s.bpjsLeads.length === 0) {
                return <div className="text-center text-sm text-muted-foreground py-8">Belum ada leads yang menyebut BPJS untuk konten ini.</div>;
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
                      {s.bpjsLeads.map((l) => {
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
