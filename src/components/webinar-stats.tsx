import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Video } from "lucide-react";

type Row = { id: string; name: string; code: string; is_active: boolean; total: number; inRange: number };

/** Webinar registration totals (all-time + within selected WIB date range). */
export function WebinarStats({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: webinars } = await supabase.from("webinars").select("id,name,code,is_active").order("created_at", { ascending: false });
      const regs: { webinar_id: string; created_at: string }[] = [];
      for (let p = 0; ; p++) {
        const { data } = await supabase.from("webinar_registrations").select("webinar_id,created_at").range(p * 1000, p * 1000 + 999);
        regs.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      const start = new Date(`${from}T00:00:00+07:00`).getTime();
      const end = new Date(`${to}T23:59:59.999+07:00`).getTime();
      const out = (webinars || []).map((w: any) => {
        const mine = regs.filter((r) => r.webinar_id === w.id);
        const inRange = mine.filter((r) => { const t = new Date(r.created_at).getTime(); return t >= start && t <= end; }).length;
        return { ...w, total: mine.length, inRange };
      });
      if (!cancelled) { setRows(out); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [from, to]);

  const total = rows.reduce((s, r) => s + r.total, 0);
  const inRange = rows.reduce((s, r) => s + r.inRange, 0);

  return (
    <Card className="glow-soft">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Video className="size-4 text-primary" /> Pendaftar Webinar</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Total semua waktu</div><div className="text-2xl font-bold">{loading ? "…" : total}</div></div>
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Periode dipilih</div><div className="text-2xl font-bold">{loading ? "…" : inRange}</div></div>
        </div>
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-1.5">Webinar</th><th>Kode</th><th className="text-right">Periode</th><th className="text-right">Total</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-1.5">{r.name}{!r.is_active && <span className="ml-1 text-xs text-muted-foreground">(nonaktif)</span>}</td>
                    <td className="font-mono text-xs">{r.code}</td>
                    <td className="text-right">{r.inRange}</td>
                    <td className="text-right font-medium">{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && rows.length === 0 && <p className="text-xs text-muted-foreground">Belum ada webinar. Tambahkan di Settings → Webinar.</p>}
      </CardContent>
    </Card>
  );
}
