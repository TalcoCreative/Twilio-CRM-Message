import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Trash2, ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

const DAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

type Agent = { id: string; full_name: string | null; email: string | null };
type Cell = { id?: string; start: string; end: string; enabled: boolean };

/** Format YYYY-MM-DD (lokal) */
function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
/** Awal minggu (Senin) untuk tanggal ts */
function startOfWeek(d: Date) {
  const x = new Date(d);
  const dow = x.getDay(); // 0=Min
  const diff = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Jadwal FR per TANGGAL (bukan template hari-minggu).
 * Setiap tanggal punya jam mulai/selesai sendiri. Data disimpan di tabel
 * `fr_date_shifts` (agent_id, work_date, start_time, end_time).
 * Dashboard menghitung metrik FR berdasarkan tanggal + jam ini secara real.
 */
export function FRWeeklySchedule() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [cells, setCells] = useState<Record<string, Cell>>({}); // key = `${agentId}:${YYYY-MM-DD}`
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const weekDates = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const dateKeys = useMemo(() => weekDates.map(ymd), [weekDates]);
  const rangeStart = dateKeys[0];
  const rangeEnd = dateKeys[6];

  async function loadAgents() {
    const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "first_response");
    const ids = (roles || []).map((r: any) => r.user_id);
    if (!ids.length) { setAgents([]); return [] as string[]; }
    const { data: pf } = await supabase.from("profiles").select("id, full_name, email").eq("is_active", true).in("id", ids);
    const list = (((pf as any[]) || []) as Agent[]).sort((a, b) =>
      (a.full_name || a.email || "").localeCompare(b.full_name || b.email || ""),
    );
    setAgents(list);
    return ids as string[];
  }

  async function loadWeek(agentIds: string[]) {
    setLoading(true);
    const next: Record<string, Cell> = {};
    agentIds.forEach((aid) => {
      dateKeys.forEach((dk) => { next[`${aid}:${dk}`] = { start: "08:00", end: "17:00", enabled: false }; });
    });
    if (agentIds.length) {
      const { data } = await supabase
        .from("fr_date_shifts" as any)
        .select("id, agent_id, work_date, start_time, end_time")
        .in("agent_id", agentIds)
        .gte("work_date", rangeStart).lte("work_date", rangeEnd);
      ((data as any[]) || []).forEach((r) => {
        next[`${r.agent_id}:${r.work_date}`] = {
          id: r.id,
          start: String(r.start_time).slice(0, 5),
          end: String(r.end_time).slice(0, 5),
          enabled: true,
        };
      });
    }
    setCells(next);
    setLoading(false);
  }

  useEffect(() => { loadAgents().then((ids) => loadWeek(ids)); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (agents.length) loadWeek(agents.map((a) => a.id)); /* eslint-disable-next-line */ }, [weekStart]);

  function updateCell(agentId: string, dateKey: string, patch: Partial<Cell>) {
    const k = `${agentId}:${dateKey}`;
    setCells((c) => ({ ...c, [k]: { ...c[k], ...patch } }));
  }

  async function saveCell(agentId: string, dateKey: string) {
    const k = `${agentId}:${dateKey}`;
    const cell = cells[k];
    if (!cell) return;
    setSaving(k);
    try {
      if (!cell.enabled) {
        if (cell.id) {
          await supabase.from("fr_date_shifts" as any).delete().eq("id", cell.id);
          updateCell(agentId, dateKey, { id: undefined });
        }
      } else if (cell.id) {
        const { error } = await supabase.from("fr_date_shifts" as any)
          .update({ start_time: cell.start, end_time: cell.end })
          .eq("id", cell.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("fr_date_shifts" as any).insert({
          agent_id: agentId, work_date: dateKey, start_time: cell.start, end_time: cell.end,
        }).select("id").maybeSingle();
        if (error) throw error;
        updateCell(agentId, dateKey, { id: (data as any)?.id });
      }
      toast.success("Tersimpan");
    } catch (e: any) {
      toast.error(e.message || "Gagal simpan");
    } finally { setSaving(null); }
  }

  async function clearCell(agentId: string, dateKey: string) {
    const k = `${agentId}:${dateKey}`;
    const cell = cells[k];
    setSaving(k);
    try {
      if (cell?.id) await supabase.from("fr_date_shifts" as any).delete().eq("id", cell.id);
      setCells((c) => ({ ...c, [k]: { start: "08:00", end: "17:00", enabled: false } }));
      toast.success("Dikosongkan");
    } catch (e: any) {
      toast.error(e.message || "Gagal");
    } finally { setSaving(null); }
  }

  async function copyMondayToWeekdays(agentId: string) {
    const src = cells[`${agentId}:${dateKeys[0]}`];
    if (!src) return;
    for (let i = 1; i <= 4; i++) {
      const dk = dateKeys[i];
      updateCell(agentId, dk, { start: src.start, end: src.end, enabled: src.enabled });
    }
    toast.info("Klik Simpan di tiap tanggal untuk menyimpan.");
  }

  function shiftWeek(delta: number) {
    const x = new Date(weekStart);
    x.setDate(x.getDate() + delta * 7);
    setWeekStart(startOfWeek(x));
  }

  const weekLabel = `${weekDates[0].toLocaleDateString("id-ID", { day: "numeric", month: "short" })} – ${weekDates[6].toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2"><CalendarDays className="size-4" /> Jadwal FR per Tanggal</CardTitle>
              <CardDescription>
                Atur jam kerja FR untuk <b>tanggal spesifik</b> — bisa berbeda tiap minggu.
                Dashboard FR (Avg First Response, SLA, Beban per Jam) memakai jadwal ini
                sesuai tanggal & jam log yang benar-benar tercatat.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => shiftWeek(-1)}><ChevronLeft className="size-4" /></Button>
              <Button size="sm" variant="outline" onClick={() => setWeekStart(startOfWeek(new Date()))}>Minggu ini</Button>
              <Button size="sm" variant="outline" onClick={() => shiftWeek(1)}><ChevronRight className="size-4" /></Button>
              <div className="text-sm font-medium ml-2 whitespace-nowrap">{weekLabel}</div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Memuat…</div>
          ) : agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada agent dengan role First Response.</p>
          ) : (
            <div className="space-y-6">
              {agents.map((a) => (
                <div key={a.id} className="border rounded-xl p-3">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div>
                      <div className="font-semibold">{a.full_name || a.email}</div>
                      <div className="text-[11px] text-muted-foreground">{a.email}</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => copyMondayToWeekdays(a.id)}>
                      Sen → Sen–Jum
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
                    {weekDates.map((d, i) => {
                      const dk = dateKeys[i];
                      const k = `${a.id}:${dk}`;
                      const cell = cells[k];
                      const busy = saving === k;
                      const isToday = dk === ymd(new Date());
                      return (
                        <div key={dk} className={`rounded-lg border p-2 ${cell?.enabled ? "border-primary/60 bg-primary/5" : "bg-muted/20"} ${isToday ? "ring-1 ring-primary" : ""}`}>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
                              <input type="checkbox" checked={!!cell?.enabled}
                                onChange={(e) => updateCell(a.id, dk, { enabled: e.target.checked })}
                                className="size-3.5 cursor-pointer" />
                              {DAY_LABELS[i]} {d.getDate()}/{d.getMonth() + 1}
                            </label>
                            {cell?.id && (
                              <button onClick={() => clearCell(a.id, dk)} className="text-destructive/70 hover:text-destructive" title="Hapus">
                                <Trash2 className="size-3" />
                              </button>
                            )}
                          </div>
                          <div className="space-y-1">
                            <Input type="time" value={cell?.start || "08:00"}
                              onChange={(e) => updateCell(a.id, dk, { start: e.target.value })}
                              disabled={!cell?.enabled}
                              className="h-7 text-xs px-1.5" />
                            <Input type="time" value={cell?.end || "17:00"}
                              onChange={(e) => updateCell(a.id, dk, { end: e.target.value })}
                              disabled={!cell?.enabled}
                              className="h-7 text-xs px-1.5" />
                            <Button size="sm" className="w-full h-7 text-[11px]" disabled={busy}
                              onClick={() => saveCell(a.id, dk)}>
                              {busy ? <Loader2 className="size-3 animate-spin" /> : "Simpan"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
