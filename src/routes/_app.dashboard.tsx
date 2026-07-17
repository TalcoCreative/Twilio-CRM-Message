import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Users, MessageSquare, Clock, TrendingUp, Inbox as InboxIcon, Wallet, UserCheck, History,
  Zap, Timer, MessageCircle, AlertTriangle, Trophy, ArrowRightLeft, CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, CartesianGrid, Legend, LabelList,
} from "recharts";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Husada CRM" }] }),
  component: DashboardGate,
});

// Bucket key pakai local time (WIB di sandbox/browser user), bukan UTC,
// supaya konsisten dgn range startISO/endISO yang dihitung dari local midnight.
const localDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function DashboardGate() {
  const { isFirstResponse, loading } = useRole();
  const router = useRouter();
  useEffect(() => { if (!loading && isFirstResponse) router.navigate({ to: "/inbox" }); }, [loading, isFirstResponse]);
  if (loading) return <div className="p-8 text-center text-muted-foreground">Memuat...</div>;
  if (isFirstResponse) return null;
  return <Dashboard />;
}

type Profile = { id: string; full_name: string | null; email: string | null; position: string | null };

// Hour buckets for response-time distribution
const HOUR_BUCKETS = [
  { label: "0j (<1j)", min: 0, max: 3600 },
  { label: "1-2j", min: 3600, max: 7200 },
  { label: "2-4j", min: 7200, max: 14400 },
  { label: "4-8j", min: 14400, max: 28800 },
  { label: "8-24j", min: 28800, max: 86400 },
  { label: ">24j", min: 86400, max: Infinity },
];
const BUCKET_COLORS = ["#10b981", "#14b8a6", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444"];

function bucketIdx(sec: number) {
  for (let i = 0; i < HOUR_BUCKETS.length; i++) if (sec < HOUR_BUCKETS[i].max) return i;
  return HOUR_BUCKETS.length - 1;
}
function fmtSec(s: number) {
  if (!s) return "—";
  if (s < 60) return `${s}d`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}j`;
}

function Dashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const [range, setRange] = useState("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [division, setDivision] = useState<string>("all");
  const [agentId, setAgentId] = useState<string>("all");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [frUserIds, setFrUserIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    supabase.from("profiles").select("id, full_name, email, position").then(({ data }) => setProfiles((data as any) || []));
    supabase.from("user_roles").select("user_id, role").eq("role", "first_response")
      .then(({ data }) => setFrUserIds(new Set(((data as any) || []).map((r: any) => r.user_id))));
  }, []);

  const divisions = useMemo(() => {
    const s = new Set<string>();
    profiles.forEach((p) => { if (p.position) s.add(p.position); });
    const arr = Array.from(s).sort();
    if (frUserIds.size > 0 && !arr.includes("First Response")) arr.unshift("First Response");
    return arr;
  }, [profiles, frUserIds]);

  const isFRTab = activeTab === "first-response";

  const visibleProfiles = useMemo(() => {
    if (division === "all") return profiles;
    if (division === "First Response") return profiles.filter((p) => frUserIds.has(p.id));
    return profiles.filter((p) => (p.position || "") === division);
  }, [profiles, division, frUserIds]);

  // Di tab First Response, agent list dibatasi hanya divisi FR (tanpa filter divisi).
  const agentOptions = useMemo(() => {
    if (isFRTab) return profiles.filter((p) => frUserIds.has(p.id));
    return visibleProfiles;
  }, [isFRTab, profiles, frUserIds, visibleProfiles]);

  // reset agent kalau tidak ada di list yang aktif
  useEffect(() => {
    if (agentId !== "all" && !agentOptions.find((p) => p.id === agentId)) setAgentId("all");
  }, [agentOptions, agentId]);

  const { startISO, endISO } = useMemo(() => {
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    if (range === "today") {}
    else if (range === "7d") start.setDate(start.getDate() - 6);
    else if (range === "30d") start.setDate(start.getDate() - 29);
    else if (range === "month") start.setDate(1);
    else if (range === "year") { start.setMonth(0); start.setDate(1); }
    else if (range === "custom" && from && to) {
      return { startISO: new Date(from + "T00:00:00").toISOString(), endISO: new Date(to + "T23:59:59").toISOString() };
    }
    return { startISO: start.toISOString(), endISO: end.toISOString() };
  }, [range, from, to]);

  // filter helper: which user IDs are in scope
  const scopeIds = useMemo(() => {
    if (agentId !== "all") return new Set([agentId]);
    if (isFRTab) return frUserIds; // FR tab: scope selalu ke agent FR
    if (division !== "all") return new Set(visibleProfiles.map((p) => p.id));
    return null; // null = all
  }, [agentId, division, visibleProfiles, isFRTab, frUserIds]);

  return (
    <div className="p-3 md:p-6 space-y-5 max-w-7xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Performa tim, first response, & pipeline.</p>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <Label className="text-xs">Rentang</Label>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hari ini</SelectItem>
                <SelectItem value="7d">7 hari</SelectItem>
                <SelectItem value="30d">30 hari</SelectItem>
                <SelectItem value="month">Bulan ini</SelectItem>
                <SelectItem value="year">Tahun ini</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {range === "custom" && (
            <>
              <div><Label className="text-xs">Dari</Label><Input type="date" className="h-9" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><Label className="text-xs">Sampai</Label><Input type="date" className="h-9" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </>
          )}
          {!isFRTab && (
            <div>
              <Label className="text-xs">Divisi</Label>
              <Select value={division} onValueChange={setDivision}>
                <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua divisi</SelectItem>
                  {divisions.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-xs">Agent{isFRTab ? " (First Response)" : ""}</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua agent</SelectItem>
                {agentOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-3 w-full md:w-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="first-response">First Response</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-5">
          <OverviewTab user={user} startISO={startISO} endISO={endISO} profiles={profiles} scopeIds={scopeIds} />
        </TabsContent>
        <TabsContent value="first-response" className="space-y-5">
          <FirstResponseTab startISO={startISO} endISO={endISO} profiles={profiles} scopeIds={scopeIds} frUserIds={frUserIds} />
        </TabsContent>
        <TabsContent value="performance" className="space-y-5">
          <PerformanceTab startISO={startISO} endISO={endISO} profiles={profiles} scopeIds={scopeIds} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================== OVERVIEW ============================== */

function OverviewTab({ user, startISO, endISO, profiles, scopeIds }: {
  user: any; startISO: string; endISO: string; profiles: Profile[]; scopeIds: Set<string> | null;
}) {
  const [data, setData] = useState<any>(null);
  const [selectedAgent, setSelectedAgent] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const startDate = localDateKey(new Date(startISO));
      const endDate = localDateKey(new Date(endISO));
      const [contacts, openConv, msgsList, respMsgs, stageLogs, allConvs, assignLogs, agentShiftsRes, frShRes] = await Promise.all([
        supabase.from("contacts").select("id, full_name, whatsapp_number, estimated_revenue, stage_id, assigned_agent_id, created_at, stages(name, color)"),
        supabase.from("conversations").select("id, contact_id, assigned_agent_id, last_message_at, last_message_preview").eq("status", "OPEN"),
        supabase.from("messages").select("sent_at, direction, sent_by_id, conversation_id").gte("sent_at", startISO).lte("sent_at", endISO),
        supabase.from("messages").select("sent_by_id, response_seconds, sent_at, conversation_id")
          .gte("sent_at", startISO).lte("sent_at", endISO).eq("direction", "OUTBOUND").not("response_seconds", "is", null),
        supabase.from("activity_logs").select("entity_id, metadata, created_at, user_id")
          .eq("action", "change_stage").gte("created_at", startISO).lte("created_at", endISO).order("created_at", { ascending: true }),
        supabase.from("conversations").select("id, contact_id, assigned_agent_id, created_at"),
        supabase.from("activity_logs").select("entity_id, metadata, created_at, user_id")
          .eq("action", "assign_agent").gte("created_at", startISO).lte("created_at", endISO),
        supabase.from("agent_shifts").select("agent_id, shifts(start_time, end_time, days_of_week, is_active)"),
        supabase.from("fr_date_shifts" as any).select("agent_id, work_date, start_time, end_time")
          .gte("work_date", startDate).lte("work_date", endDate),
      ]);

      const allContacts = (contacts.data || []) as any[];
      const openConvsAll = (openConv.data || []) as any[];
      const allConvsAll = (allConvs.data || []) as any[];

      // Peta conversation -> agent yang di-assign (semua conversation).
      const convAgent: Record<string, string | null> = {};
      allConvsAll.forEach((c: any) => { convAgent[c.id] = c.assigned_agent_id; });
      openConvsAll.forEach((c: any) => { convAgent[c.id] = c.assigned_agent_id; });

      // ==== Bangun window shift per agent (agent_shifts + fr_date_shifts) ====
      const startMs = new Date(startISO).getTime();
      const endMs = new Date(endISO).getTime();
      const shiftIntervals: Record<string, Array<[number, number]>> = {};
      const addInt = (aid: string, s: number, e: number) => {
        if (e <= s) return;
        const cs = Math.max(s, startMs), ce = Math.min(e, endMs);
        if (ce <= cs) return;
        (shiftIntervals[aid] ||= []).push([cs, ce]);
      };
      const days: Date[] = [];
      const dCursor = new Date(startISO); dCursor.setHours(0, 0, 0, 0);
      while (dCursor.getTime() <= endMs) {
        days.push(new Date(dCursor));
        dCursor.setDate(dCursor.getDate() + 1);
      }
      ((agentShiftsRes.data as any[]) || []).forEach((row: any) => {
        const sh = row.shifts;
        if (!sh || !sh.is_active) return;
        const [sh_h, sh_m] = String(sh.start_time).split(":").map(Number);
        const [eh, em] = String(sh.end_time).split(":").map(Number);
        const dows: number[] = sh.days_of_week || [];
        days.forEach((d) => {
          if (!dows.includes(d.getDay())) return;
          const ds = new Date(d); ds.setHours(sh_h, sh_m, 0, 0);
          const de = new Date(d); de.setHours(eh, em, 0, 0);
          if (de.getTime() <= ds.getTime()) de.setDate(de.getDate() + 1);
          addInt(row.agent_id, ds.getTime(), de.getTime());
        });
      });
      ((frShRes.data as any[]) || []).forEach((row: any) => {
        const [sh, sm] = String(row.start_time).split(":").map(Number);
        const [eh, em] = String(row.end_time).split(":").map(Number);
        const base = new Date(row.work_date + "T00:00:00");
        const ds = new Date(base); ds.setHours(sh, sm, 0, 0);
        const de = new Date(base); de.setHours(eh, em, 0, 0);
        if (de.getTime() <= ds.getTime()) de.setDate(de.getDate() + 1);
        addInt(row.agent_id, ds.getTime(), de.getTime());
      });
      const inShift = (aid: string, ts: number) => {
        const arr = shiftIntervals[aid];
        if (!arr) return false;
        for (const [s, e] of arr) if (ts >= s && ts <= e) return true;
        return false;
      };

      // ==== Response messages ====
      const allRespRaw = (respMsgs.data || []) as any[];
      // Scope filter (agent/divisi) untuk kartu "Avg Respon".
      const scopedResp = scopeIds ? allRespRaw.filter((m) => m.sent_by_id && scopeIds.has(m.sent_by_id)) : allRespRaw;
      const teamAvg = scopedResp.length ? Math.round(scopedResp.reduce((s, m) => s + (m.response_seconds || 0), 0) / scopedResp.length) : 0;

      // Filter ketat untuk chart per-agent:
      //  (1) pesan dari agent, (2) conversation-nya di-assign ke agent itu,
      //  (3) waktu kirim jatuh di dalam window shift agent tsb.
      const strictResp = scopedResp.filter((m: any) => {
        if (!m.sent_by_id || !m.conversation_id) return false;
        if (convAgent[m.conversation_id] !== m.sent_by_id) return false;
        return inShift(m.sent_by_id, new Date(m.sent_at).getTime());
      });

      const buckets = HOUR_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
      strictResp.forEach((m: any) => { buckets[bucketIdx(m.response_seconds || 0)].count++; });

      const perAgent: Record<string, { count: number; total: number; buckets: number[] }> = {};
      strictResp.forEach((m: any) => {
        perAgent[m.sent_by_id] = perAgent[m.sent_by_id] || { count: 0, total: 0, buckets: HOUR_BUCKETS.map(() => 0) };
        perAgent[m.sent_by_id].count++;
        perAgent[m.sent_by_id].total += m.response_seconds || 0;
        perAgent[m.sent_by_id].buckets[bucketIdx(m.response_seconds || 0)]++;
      });
      const profMap: Record<string, Profile> = {};
      profiles.forEach((p) => { profMap[p.id] = p; });

      const agentStats = Object.entries(perAgent).map(([id, v]) => {
        const p = profMap[id];
        const rec: any = {
          id, name: p?.full_name || p?.email?.split("@")[0] || "Agent",
          division: p?.position || "—",
          avg: Math.round(v.total / v.count),
          avgMin: +(v.total / v.count / 60).toFixed(1),
          avgHours: +(v.total / v.count / 3600).toFixed(2),
          count: v.count,
        };
        HOUR_BUCKETS.forEach((b, i) => { rec[b.label] = v.buckets[i]; });
        return rec;
      }).sort((a, b) => a.avg - b.avg);

      // Stage distribution & revenue — di-scope oleh filter (untuk konteks divisi/agent).
      const scopedContactIds: Set<string> | null = scopeIds ? new Set<string>() : null;
      if (scopedContactIds) {
        allContacts.forEach((c: any) => { if (c.assigned_agent_id && scopeIds!.has(c.assigned_agent_id)) scopedContactIds.add(c.id); });
        openConvsAll.forEach((c: any) => { if (c.assigned_agent_id && scopeIds!.has(c.assigned_agent_id)) scopedContactIds.add(c.contact_id); });
      }
      const scopedContacts = scopedContactIds ? allContacts.filter((c) => scopedContactIds.has(c.id)) : allContacts;

      const byStage: Record<string, { name: string; color: string; count: number }> = {};
      let totalRevenue = 0;
      scopedContacts.forEach((r: any) => {
        const name = r.stages?.name || "Tanpa stage";
        const color = r.stages?.color || "#888";
        byStage[name] = byStage[name] || { name, color, count: 0 };
        byStage[name].count++;
        totalRevenue += Number(r.estimated_revenue) || 0;
      });
      const stageDist = Object.values(byStage).sort((a, b) => b.count - a.count);
      const topStage = stageDist[0];

      // Volume Pesan Harian: seluruh bubble (tidak di-scope).
      const dayMap: Record<string, { date: string; in: number; out: number }> = {};
      (msgsList.data || []).forEach((m: any) => {
        const d = localDateKey(new Date(m.sent_at));
        dayMap[d] = dayMap[d] || { date: d, in: 0, out: 0 };
        if (m.direction === "INBOUND") dayMap[d].in++; else dayMap[d].out++;
      });
      const dailySeries = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date))
        .map((d) => ({ ...d, label: d.date.slice(5) }));

      // Stage transitions
      const convToContact: Record<string, string> = {};
      allConvsAll.forEach((c: any) => { convToContact[c.id] = c.contact_id; });
      const contactCreated: Record<string, string> = {};
      allContacts.forEach((c: any) => { contactCreated[c.id] = c.created_at; });

      const perContactLogs: Record<string, any[]> = {};
      (stageLogs.data || []).forEach((l: any) => {
        const m = l.metadata || {};
        const cid = m.contact_id || convToContact[l.entity_id];
        if (!cid) return;
        if (scopeIds && l.user_id && !scopeIds.has(l.user_id)) return;
        perContactLogs[cid] = perContactLogs[cid] || [];
        perContactLogs[cid].push(l);
      });
      const edgeAgg: Record<string, { from: string; to: string; total: number; count: number }> = {};
      Object.entries(perContactLogs).forEach(([cid, lgs]) => {
        lgs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        let prevTime = contactCreated[cid] ? new Date(contactCreated[cid]).getTime() : null;
        lgs.forEach((l: any) => {
          const m = l.metadata || {};
          const from = m.from_stage || "Awal";
          const to = m.to_stage || "—";
          const t = new Date(l.created_at).getTime();
          if (prevTime !== null) {
            const dur = (t - prevTime) / 1000;
            if (dur > 0) {
              const key = `${from}→${to}`;
              edgeAgg[key] = edgeAgg[key] || { from, to, total: 0, count: 0 };
              edgeAgg[key].total += dur;
              edgeAgg[key].count++;
            }
          }
          prevTime = t;
        });
      });
      const transitions = Object.values(edgeAgg).map((e) => ({
        edge: `${e.from} → ${e.to}`,
        count: e.count,
        avgSec: Math.round(e.total / e.count),
        avgHours: +(e.total / e.count / 3600).toFixed(2),
      })).sort((a, b) => b.count - a.count);

      const myInbox = openConvsAll.filter((c: any) => c.assigned_agent_id === user?.id).length;

      // Leads per agent
      const contactMap: Record<string, any> = {};
      allContacts.forEach((c: any) => { contactMap[c.id] = c; });

      const histAgg: Record<string, { id: string; assignCount: number; contactIds: Set<string> }> = {};
      (assignLogs.data || []).forEach((l: any) => {
        const m = l.metadata || {};
        const toId = m.to_agent;
        if (!toId) return;
        if (scopeIds && !scopeIds.has(toId)) return;
        histAgg[toId] = histAgg[toId] || { id: toId, assignCount: 0, contactIds: new Set() };
        histAgg[toId].assignCount++;
        const cid = convToContact[l.entity_id];
        if (cid) histAgg[toId].contactIds.add(cid);
      });

      const currentAgg: Record<string, { id: string; convs: any[] }> = {};
      openConvsAll.forEach((c: any) => {
        if (!c.assigned_agent_id) return;
        if (scopeIds && !scopeIds.has(c.assigned_agent_id)) return;
        const id = c.assigned_agent_id;
        currentAgg[id] = currentAgg[id] || { id, convs: [] };
        const contact = contactMap[c.contact_id] || {};
        currentAgg[id].convs.push({
          conversation_id: c.id, contact_id: c.contact_id, full_name: contact.full_name,
          whatsapp_number: contact.whatsapp_number, stage: contact.stages?.name,
          stage_color: contact.stages?.color, last_message_at: c.last_message_at,
          last_message_preview: c.last_message_preview,
        });
      });

      const agentLeadStats = profiles.map((p) => {
        if (scopeIds && !scopeIds.has(p.id)) return null;
        const h = histAgg[p.id]; const c = currentAgg[p.id];
        return {
          id: p.id, name: p.full_name || p.email?.split("@")[0] || "Agent",
          email: p.email, division: p.position || "—",
          historicalUnique: h ? h.contactIds.size : 0,
          historicalTotal: h ? h.assignCount : 0,
          currentCount: c ? c.convs.length : 0,
          currentList: c ? c.convs : [],
          historicalContactIds: h ? Array.from(h.contactIds) : [],
        };
      }).filter((a): a is any => !!a && (a.historicalTotal > 0 || a.currentCount > 0))
        .sort((a, b) => b.currentCount - a.currentCount || b.historicalUnique - a.historicalUnique);

      setData({
        totalContacts: allContacts.length,               // Total Leads = seluruh /leads
        openConv: openConvsAll.length,                   // Percakapan Aktif = seluruh open
        messagesRange: (msgsList.data || []).length,     // Pesan = seluruh bubble di rentang
        teamAvg, agentStats, stageDist, topStage, totalRevenue,
        myInbox, dailySeries, transitions,
        agentLeadStats, contactMap, buckets,
      });
    })();
  }, [startISO, endISO, user?.id, profiles, scopeIds]);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={InboxIcon} label="My Inbox" value={data?.myInbox ?? "—"} />
        <StatCard icon={MessageSquare} label="Percakapan Aktif" value={data?.openConv ?? "—"} />
        <StatCard icon={Clock} label="Avg Respon" value={fmtSec(data?.teamAvg || 0)} />
        <StatCard icon={Users} label="Total Leads" value={data?.totalContacts ?? "—"} />
        <StatCard icon={MessageSquare} label="Pesan" value={data?.messagesRange ?? "—"} />
        <StatCard icon={TrendingUp} label="Stage Teratas" value={data?.topStage?.name ?? "—"} />
        <StatCard icon={Wallet} label="Est. Revenue" value={`Rp ${(data?.totalRevenue || 0).toLocaleString("id-ID")}`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="glow-soft lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Volume Pesan Harian</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data?.dailySeries || []}>
                <defs>
                  <linearGradient id="gIn" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gOut" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} wrapperStyle={tooltipWrapperStyle} cursor={tooltipCursor} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="in" name="Masuk" stroke="hsl(var(--primary))" fill="url(#gIn)" strokeWidth={2} />
                <Area type="monotone" dataKey="out" name="Keluar" stroke="#10b981" fill="url(#gOut)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="glow-soft">
          <CardHeader><CardTitle className="text-base">Distribusi Stage</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={data?.stageDist || []} dataKey="count" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                  {(data?.stageDist || []).map((s: any, i: number) => (
                    <Cell key={i} fill={s.color || "#888"} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} wrapperStyle={tooltipWrapperStyle} cursor={tooltipCursor} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1 mt-2 max-h-32 overflow-auto">
              {(data?.stageDist || []).map((s: any) => (
                <div key={s.name} className="flex items-center gap-2 text-xs">
                  <div className="size-2 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="font-semibold tabular-nums">{s.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Distribusi Waktu Respon — INFOGRAPHIC */}
      <Card className="glow-soft">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Clock className="size-4" /> Distribusi Waktu Respon (per jam)</CardTitle>
          <p className="text-xs text-muted-foreground">Berapa pesan keluar yang dijawab dalam berapa jam. Filter agent/divisi di atas akan menyesuaikan.</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-4">
            {(data?.buckets || HOUR_BUCKETS.map((b) => ({ label: b.label, count: 0 }))).map((b: any, i: number) => (
              <div key={b.label} className="rounded-xl border p-3 text-center bg-card">
                <div className="text-2xl font-bold" style={{ color: BUCKET_COLORS[i] }}>{b.count}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{b.label}</div>
              </div>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data?.buckets || []}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="label" fontSize={11} />
              <YAxis fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} wrapperStyle={tooltipWrapperStyle} cursor={tooltipCursor} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {(data?.buckets || []).map((_: any, i: number) => <Cell key={i} fill={BUCKET_COLORS[i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="glow-soft">
          <CardHeader>
            <CardTitle className="text-base">Avg Respon per Agent (menit)</CardTitle>
            <p className="text-xs text-muted-foreground">Hanya pesan agent di dalam jam shift & chat yang di-assign ke agent tsb.</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(260, (data?.agentStats?.length || 0) * 38)}>
              <BarChart data={data?.agentStats || []} layout="vertical" margin={{ left: 10, right: 48 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis type="number" fontSize={11} />
                <YAxis type="category" dataKey="name" fontSize={11} width={100} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} wrapperStyle={tooltipWrapperStyle} cursor={tooltipCursor} />
                <Bar dataKey="avgMin" name="Menit" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]}>
                  <LabelList dataKey="avgMin" position="right" fill="hsl(var(--foreground))" fontSize={11} formatter={(v: any) => `${v} m`} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {!data?.agentStats?.length && <p className="text-center text-sm text-muted-foreground py-8">Belum ada data respon.</p>}
          </CardContent>
        </Card>

        <Card className="glow-soft">
          <CardHeader><CardTitle className="text-base">Leads per Stage</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data?.stageDist || []}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="name" fontSize={10} angle={-20} textAnchor="end" height={60} interval={0} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} wrapperStyle={tooltipWrapperStyle} cursor={tooltipCursor} />
                <Bar dataKey="count" name="Jumlah" radius={[6, 6, 0, 0]}>
                  {(data?.stageDist || []).map((s: any, i: number) => (
                    <Cell key={i} fill={s.color || "hsl(var(--primary))"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Per-agent hour-bucket stack — INFOGRAPHIC */}
      <Card className="glow-soft">
        <CardHeader>
          <CardTitle className="text-base">Sebaran Waktu Respon per Agent (stacked)</CardTitle>
          <p className="text-xs text-muted-foreground">Komposisi cepat vs lambat per agent — semakin banyak hijau, semakin responsif.</p>
        </CardHeader>
        <CardContent>
          {!data?.agentStats?.length ? (
            <p className="text-center text-sm text-muted-foreground py-8">Belum ada data.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, (data.agentStats.length) * 38)}>
              <BarChart data={data.agentStats} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis type="number" fontSize={11} allowDecimals={false} />
                <YAxis type="category" dataKey="name" fontSize={11} width={100} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} wrapperStyle={tooltipWrapperStyle} cursor={tooltipCursor} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {HOUR_BUCKETS.map((b, i) => (
                  <Bar key={b.label} dataKey={b.label} stackId="a" fill={BUCKET_COLORS[i]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="glow-soft">
        <CardHeader>
          <CardTitle className="text-base">Avg Perpindahan Stage</CardTitle>
          <p className="text-xs text-muted-foreground">Rata-rata waktu (jam) & jumlah perpindahan antar stage.</p>
        </CardHeader>
        <CardContent>
          {(!data?.transitions || data.transitions.length === 0) ? (
            <p className="text-center text-sm text-muted-foreground py-8">Belum ada perpindahan stage pada rentang ini.</p>
          ) : (
            <div className="grid lg:grid-cols-2 gap-4">
              <ResponsiveContainer width="100%" height={Math.max(220, data.transitions.length * 32)}>
                <BarChart data={data.transitions} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" fontSize={11} />
                  <YAxis type="category" dataKey="edge" fontSize={11} width={160} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} wrapperStyle={tooltipWrapperStyle} cursor={tooltipCursor} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="avgHours" name="Avg (jam)" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
                  <Bar dataKey="count" name="Jumlah" fill="#10b981" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b">
                      <th className="text-left py-2">Perpindahan</th>
                      <th className="text-right">Jumlah</th>
                      <th className="text-right">Rata-rata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.transitions.map((t: any) => (
                      <tr key={t.edge} className="border-b">
                        <td className="py-2 pr-2">{t.edge}</td>
                        <td className="text-right tabular-nums">{t.count}</td>
                        <td className="text-right tabular-nums">{fmtSec(t.avgSec)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glow-soft">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><UserCheck className="size-4" /> Leads per Agent — Historis dan Saat ini</CardTitle>
          <p className="text-xs text-muted-foreground"><b>Historis</b>: unik di-assign pada rentang. <b>Saat ini</b>: dipegang saat ini. Klik baris untuk detail.</p>
        </CardHeader>
        <CardContent>
          {(!data?.agentLeadStats || data.agentLeadStats.length === 0) ? (
            <p className="text-center text-sm text-muted-foreground py-8">Belum ada data assignment.</p>
          ) : (
            <div className="grid lg:grid-cols-2 gap-4">
              <ResponsiveContainer width="100%" height={Math.max(220, data.agentLeadStats.length * 38)}>
                <BarChart data={data.agentLeadStats} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" fontSize={11} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" fontSize={11} width={100} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} wrapperStyle={tooltipWrapperStyle} cursor={tooltipCursor} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="historicalUnique" name="Historis (unik)" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
                  <Bar dataKey="currentCount" name="Sedang dipegang" fill="#10b981" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b">
                      <th className="text-left py-2">Agent</th>
                      <th className="text-right">Historis</th>
                      <th className="text-right">Saat ini</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.agentLeadStats.map((a: any) => (
                      <tr key={a.id} className="border-b hover:bg-accent/40 cursor-pointer" onClick={() => setSelectedAgent(a)}>
                        <td className="py-2 pr-2 font-medium">{a.name}</td>
                        <td className="text-right tabular-nums">{a.historicalUnique}</td>
                        <td className="text-right tabular-nums"><Badge variant="secondary">{a.currentCount}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AgentDetailDialog agent={selectedAgent} contactMap={data?.contactMap || {}} onClose={() => setSelectedAgent(null)} />
    </>
  );
}

/* ============================== FIRST RESPONSE ============================== */

function FirstResponseTab({ startISO, endISO, profiles, scopeIds, frUserIds }: {
  startISO: string; endISO: string; profiles: Profile[]; scopeIds: Set<string> | null;
  frUserIds: Set<string>;
}) {
  const [data, setData] = useState<any>(null);
  const [slaGreen, setSlaGreen] = useState(5);
  const [slaYellow, setSlaYellow] = useState(10);

  // Kalau user pilih agent tunggal (harus FR karena parent sudah membatasi list).
  const selectedAgent = useMemo(
    () => (scopeIds && scopeIds.size === 1 ? Array.from(scopeIds)[0] : null),
    [scopeIds],
  );

  useEffect(() => {
    (async () => {
      const { data: settings } = await supabase.from("system_settings").select("key,value")
        .in("key", ["sla_green_minutes", "sla_yellow_minutes"]);
      (settings || []).forEach((s: any) => {
        if (s.key === "sla_green_minutes") setSlaGreen(Number(s.value) || 5);
        if (s.key === "sla_yellow_minutes") setSlaYellow(Number(s.value) || 10);
      });
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const [evRes, invRes, invSentRes, convRes, ctRes] = await Promise.all([
        supabase.from("audit_events")
          .select("event_type, actor_id, contact_id, conversation_id, occurred_at, new_value, old_value")
          .gte("occurred_at", startISO).lte("occurred_at", endISO)
          .order("occurred_at", { ascending: true }).limit(20000),
        supabase.from("assignment_invitations")
          .select("id, from_user_id, to_user_id, contact_id, conversation_id, status, responded_at, created_at")
          .eq("status", "accepted")
          .gte("responded_at", startISO).lte("responded_at", endISO),
        supabase.from("assignment_invitations")
          .select("id, from_user_id, to_user_id, status, created_at")
          .gte("created_at", startISO).lte("created_at", endISO),
        supabase.from("conversations")
          .select("id, contact_id, assigned_agent_id, unread_count, last_message_at, last_replied_by_id"),
        supabase.from("contacts").select("id, full_name, whatsapp_number, stage_id, created_at, assigned_agent_id"),
      ]);
      const evs = (evRes.data || []) as any[];
      const invs = (invRes.data || []) as any[];
      const invSent = (invSentRes.data || []) as any[];
      const convs = (convRes.data || []) as any[];
      const contactById: Record<string, any> = {};
      (ctRes.data || []).forEach((c: any) => { contactById[c.id] = c; });
      const nameById: Record<string, string> = {};
      profiles.forEach((p) => { nameById[p.id] = p.full_name || p.email || "Agent"; });

      // Hanya invitation accepted, dari FR → non-FR yang dianggap "closing".
      const closingInvs = invs.filter((i) =>
        frUserIds.has(i.from_user_id) && !frUserIds.has(i.to_user_id),
      );

      type FRStat = {
        id: string; name: string;
        firstChats: number; continuedFromOther: number;
        closings: number; closingShare: number;
        respAnsweredCount: number; respAnsweredTotalSec: number;
        firstRespSecList: number[];
        handleSecList: number[];
        leadsHandledContactIds: Set<string>;
      };
      const fr: Record<string, FRStat> = {};
      const ensureFR = (id: string) => fr[id] = fr[id] || {
        id, name: nameById[id] || "Agent",
        firstChats: 0, continuedFromOther: 0, closings: 0, closingShare: 0,
        respAnsweredCount: 0, respAnsweredTotalSec: 0,
        firstRespSecList: [], handleSecList: [],
        leadsHandledContactIds: new Set(),
      };
      frUserIds.forEach((id) => ensureFR(id));

      // Per-cycle state (cycle mulai saat contact_created / chat_in pertama,
      // reset saat closing invitation accepted).
      const cycleStartTs: Record<string, number> = {};
      const pendingInboundTs: Record<string, number> = {};
      const firstFRActor: Record<string, string> = {};
      const firstFRTs: Record<string, number> = {};
      const frTouchers: Record<string, string[]> = {};

      const eventMessageType = (event: any) => String(event?.new_value?.type || "").toUpperCase();
      const isInternalNoteEvent = (event: any) => eventMessageType(event) === "INTERNAL_NOTE";
      const valueAgentId = (value: any) => (typeof value?.agent_id === "string" ? value.agent_id : null);

      // Captured details untuk drill-down (klik KPI card).
      const continueDetails: { contact_id: string; actor_id: string; previous_actor_id: string | null; at: string; via: string }[] = [];

      const markContinueFromFR = (contactId: string, actorId: string, previousFrId: string | null | undefined, at: string, via: string) => {
        if (!contactId || !actorId || !frUserIds.has(actorId)) return;
        if (previousFrId && frUserIds.has(previousFrId) && previousFrId !== actorId && !firstFRActor[contactId]) {
          firstFRActor[contactId] = previousFrId;
        }
        const initial = firstFRActor[contactId] ? [firstFRActor[contactId]] : [];
        const list = frTouchers[contactId] = frTouchers[contactId] || initial;
        if (previousFrId && frUserIds.has(previousFrId) && previousFrId !== actorId && !list.includes(previousFrId)) {
          list.unshift(previousFrId);
        }
        if (list.some((id) => id !== actorId) && !list.includes(actorId)) {
          list.push(actorId);
          ensureFR(actorId).continuedFromOther++;
          continueDetails.push({ contact_id: contactId, actor_id: actorId, previous_actor_id: previousFrId || null, at, via });
        }
        ensureFR(actorId).leadsHandledContactIds.add(contactId);
      };

      // Seed dari histori: kalau contact sudah pernah dibalas FR SEBELUM rentang,
      // set FR pertama itu sebagai firstFRActor supaya balasan FR lain di rentang
      // dihitung sbg "continue conversation", bukan "first chat".
      const contactIdsInRange = Array.from(new Set(evs.map((e) => e.contact_id).filter(Boolean)));
      if (contactIdsInRange.length && frUserIds.size) {
        const CHUNK = 200;
        const priorFR: any[] = [];
        for (let i = 0; i < contactIdsInRange.length; i += CHUNK) {
          const slice = contactIdsInRange.slice(i, i + CHUNK);
          const { data: prior } = await supabase.from("audit_events")
            .select("actor_id, contact_id, occurred_at, new_value")
            .eq("event_type", "chat_out")
            .in("contact_id", slice)
            .in("actor_id", Array.from(frUserIds))
            .lt("occurred_at", startISO)
            .order("occurred_at", { ascending: true })
            .limit(20000);
          if (prior) priorFR.push(...prior);
        }
        for (const p of priorFR) {
          if (!p.contact_id || !p.actor_id) continue;
          if (isInternalNoteEvent(p)) continue;
          if (!firstFRActor[p.contact_id]) {
            firstFRActor[p.contact_id] = p.actor_id;
            firstFRTs[p.contact_id] = new Date(p.occurred_at).getTime();
          }
          const list = frTouchers[p.contact_id] = frTouchers[p.contact_id] || [];
          if (!list.includes(p.actor_id)) list.push(p.actor_id);
        }
      }

      const responses: { actor_id: string; contact_id: string; seconds: number; at: string }[] = [];
      const firstResponses: { actor_id: string; contact_id: string; seconds: number; at: string }[] = [];


      for (const e of evs) {
        const t = new Date(e.occurred_at).getTime();
        if (e.event_type === "contact_created") {
          if (!cycleStartTs[e.contact_id]) cycleStartTs[e.contact_id] = t;
        } else if (e.event_type === "chat_in") {
          if (!cycleStartTs[e.contact_id]) cycleStartTs[e.contact_id] = t;
          pendingInboundTs[e.contact_id] = t;
        } else if (e.event_type === "chat_out" && e.actor_id) {
          if (isInternalNoteEvent(e)) continue;
          const isFR = frUserIds.has(e.actor_id);
          if (isFR) {
            const s = ensureFR(e.actor_id);
            if (!firstFRActor[e.contact_id]) {
              firstFRActor[e.contact_id] = e.actor_id;
              firstFRTs[e.contact_id] = t;
              s.firstChats++;
              const cs = cycleStartTs[e.contact_id];
              if (cs) {
                const frSec = Math.max(0, Math.round((t - cs) / 1000));
                s.firstRespSecList.push(frSec);
                firstResponses.push({ actor_id: e.actor_id, contact_id: e.contact_id, seconds: frSec, at: e.occurred_at });
              }
              (frTouchers[e.contact_id] = frTouchers[e.contact_id] || []).push(e.actor_id);
            } else if (firstFRActor[e.contact_id] !== e.actor_id) {
              markContinueFromFR(e.contact_id, e.actor_id, firstFRActor[e.contact_id]);
            }
            s.leadsHandledContactIds.add(e.contact_id);

            if (pendingInboundTs[e.contact_id]) {
              const secs = Math.max(0, Math.round((t - pendingInboundTs[e.contact_id]) / 1000));
              s.respAnsweredCount++;
              s.respAnsweredTotalSec += secs;
              responses.push({ actor_id: e.actor_id, contact_id: e.contact_id, seconds: secs, at: e.occurred_at });
              delete pendingInboundTs[e.contact_id];
            }
          } else if (pendingInboundTs[e.contact_id]) {
            delete pendingInboundTs[e.contact_id];
          }
        } else if ((e.event_type === "conv_takeover" || e.event_type === "reassigned") && e.actor_id) {
          const oldAgent = valueAgentId(e.old_value);
          const newAgent = valueAgentId(e.new_value);
          if (newAgent === e.actor_id && oldAgent && frUserIds.has(oldAgent) && oldAgent !== e.actor_id) {
            markContinueFromFR(e.contact_id, e.actor_id, oldAgent);
          }
        }
      }

      // Distribusi closing + share dari invitation accepted.
      // - Total Closing hanya untuk pembuat invitation (from_user_id).
      // - Closing Share hanya dibagi kalau >1 unique FR handle sebelum invitation.
      //   Solo handler → tidak ada share sama sekali (sudah dapat Total Closing).
      for (const inv of closingInvs) {
        const closerId = inv.from_user_id;
        const c = ensureFR(closerId);
        c.closings++;

        const touchers = (frTouchers[inv.contact_id] && frTouchers[inv.contact_id].length)
          ? frTouchers[inv.contact_id].slice()
          : (firstFRActor[inv.contact_id] ? [firstFRActor[inv.contact_id]] : [closerId]);
        if (!touchers.includes(closerId)) touchers.push(closerId);

        if (touchers.length > 1) {
          const share = 1 / touchers.length;
          touchers.forEach((tid) => { ensureFR(tid).closingShare += share; });
        }

        const respondedTs = inv.responded_at ? new Date(inv.responded_at).getTime() : null;
        const firstTs = firstFRTs[inv.contact_id];
        if (respondedTs && firstTs && respondedTs >= firstTs) {
          const handleSec = Math.round((respondedTs - firstTs) / 1000);
          touchers.forEach((tid) => { ensureFR(tid).handleSecList.push(handleSec); });
        }
      }


      const inScope = (id: string) => !selectedAgent || id === selectedAgent;
      const frInScopeIds = Array.from(frUserIds).filter(inScope);

      // Leads baru = contact_created dalam rentang; kalau filter agent, hanya
      // leads di mana agent tsb yang menjadi first responder.
      const createdInRange = evs.filter((e) => e.event_type === "contact_created");
      const newLeads = selectedAgent
        ? createdInRange.filter((e) => firstFRActor[e.contact_id] === selectedAgent).length
        : createdInRange.length;

      const answeredContacts = new Set<string>();
      if (selectedAgent) {
        (fr[selectedAgent]?.leadsHandledContactIds || new Set()).forEach((cid) => answeredContacts.add(cid));
      } else {
        frInScopeIds.forEach((id) => fr[id]?.leadsHandledContactIds.forEach((cid) => answeredContacts.add(cid)));
      }

      const scopedResponses = selectedAgent
        ? responses.filter((r) => r.actor_id === selectedAgent)
        : responses.filter((r) => frUserIds.has(r.actor_id));
      const totalResp = scopedResponses.length;
      const avgSec = totalResp
        ? Math.round(scopedResponses.reduce((s, r) => s + r.seconds, 0) / totalResp)
        : 0;

      const scopedFR = selectedAgent
        ? firstResponses.filter((r) => r.actor_id === selectedAgent)
        : firstResponses.filter((r) => frUserIds.has(r.actor_id));
      const avgFirstRespSec = scopedFR.length
        ? Math.round(scopedFR.reduce((s, r) => s + r.seconds, 0) / scopedFR.length)
        : 0;

      const totalFirst = frInScopeIds.reduce((s, id) => s + (fr[id]?.firstChats || 0), 0);
      const totalContinue = frInScopeIds.reduce((s, id) => s + (fr[id]?.continuedFromOther || 0), 0);
      const totalClosing = frInScopeIds.reduce((s, id) => s + (fr[id]?.closings || 0), 0);
      const totalShare = +frInScopeIds.reduce((s, id) => s + (fr[id]?.closingShare || 0), 0).toFixed(2);
      const allHandle = frInScopeIds.flatMap((id) => fr[id]?.handleSecList || []);
      const avgHandle = allHandle.length ? Math.round(allHandle.reduce((s, x) => s + x, 0) / allHandle.length) : 0;

      // Belum dijawab = conversation dengan unread inbound. Kalau filter agent,
      // hanya yang currently assigned ke agent tsb. Default = assigned ke FR/unassigned.
      let unrespondedConvs = convs.filter((c) => (c.unread_count || 0) > 0);
      if (selectedAgent) {
        unrespondedConvs = unrespondedConvs.filter((c) => c.assigned_agent_id === selectedAgent);
      } else {
        unrespondedConvs = unrespondedConvs.filter(
          (c) => !c.assigned_agent_id || frUserIds.has(c.assigned_agent_id),
        );
      }
      const unresponded = unrespondedConvs.length;

      const greenS = slaGreen * 60;
      const yellowS = slaYellow * 60;
      const slaCount = { green: 0, yellow: 0, red: 0 };
      scopedFR.forEach((r) => {
        if (r.seconds <= greenS) slaCount.green++;
        else if (r.seconds <= yellowS) slaCount.yellow++;
        else slaCount.red++;
      });
      const slaPct = scopedFR.length ? Math.round((slaCount.green / scopedFR.length) * 100) : 0;

      const hourBuckets = HOUR_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
      scopedFR.forEach((r) => { hourBuckets[bucketIdx(r.seconds)].count++; });

      const hourly: Record<number, number> = {};
      for (let h = 0; h < 24; h++) hourly[h] = 0;
      createdInRange.forEach((e) => {
        if (selectedAgent && firstFRActor[e.contact_id] !== selectedAgent) return;
        hourly[new Date(e.occurred_at).getHours()]++;
      });
      const hourlyData = Object.entries(hourly).map(([h, c]) => ({ hour: `${String(h).padStart(2, "0")}:00`, count: c }));

      const days: Record<string, { date: string; leads: number; responded: number }> = {};
      const dStart = new Date(startISO); const dEnd = new Date(endISO);
      for (let d = new Date(dStart); d <= dEnd; d.setDate(d.getDate() + 1)) {
        const key = localDateKey(d);
        const label = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        days[key] = { date: label, leads: 0, responded: 0 };
      }
      createdInRange.forEach((e) => {
        const key = localDateKey(new Date(e.occurred_at));
        if (!days[key]) return;
        if (selectedAgent && firstFRActor[e.contact_id] !== selectedAgent) return;
        days[key].leads++;
      });
      scopedFR.forEach((r) => {
        const key = localDateKey(new Date(r.at));
        if (days[key]) days[key].responded++;
      });
      const trend = Object.values(days);

      // Rincian jam kerja (dari log aktivitas apa saja).
      type DayWork = { date: string; firstMs: number; lastMs: number; count: number };
      const workByAgent: Record<string, Record<string, DayWork>> = {};
      evs.forEach((e: any) => {
        if (!e.actor_id) return;
        const d = new Date(e.occurred_at);
        const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const t = d.getTime();
        const perAgent = workByAgent[e.actor_id] = workByAgent[e.actor_id] || {};
        const day = perAgent[dayKey] = perAgent[dayKey] || { date: dayKey, firstMs: t, lastMs: t, count: 0 };
        if (t < day.firstMs) day.firstMs = t;
        if (t > day.lastMs) day.lastMs = t;
        day.count++;
      });

      const frAgents = frInScopeIds.map((id) => {
        const s = fr[id];
        const daysWorked = workByAgent[id] ? Object.values(workByAgent[id]) : [];
        const totalWorkH = daysWorked.reduce((sum, d) => sum + (d.lastMs - d.firstMs) / 3600000, 0);
        const avgWorkH = daysWorked.length ? totalWorkH / daysWorked.length : 0;
        const avgFR = s.firstRespSecList.length
          ? Math.round(s.firstRespSecList.reduce((a, b) => a + b, 0) / s.firstRespSecList.length) : 0;
        const avgResp = s.respAnsweredCount ? Math.round(s.respAnsweredTotalSec / s.respAnsweredCount) : 0;
        const avgHandleSec = s.handleSecList.length
          ? Math.round(s.handleSecList.reduce((a, b) => a + b, 0) / s.handleSecList.length) : 0;
        return {
          id, name: nameById[id] || "Agent",
          firstChats: s.firstChats,
          continuedFromOther: s.continuedFromOther,
          closings: s.closings,
          closingShare: +s.closingShare.toFixed(2),
          avgFirstRespSec: avgFR,
          avgRespSec: avgResp,
          avgHandleSec,
          avgWorkHours: +avgWorkH.toFixed(2),
          daysActive: daysWorked.length,
          dailyWork: daysWorked
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((d) => ({
              date: d.date,
              startMs: d.firstMs,
              endMs: d.lastMs,
              hours: +((d.lastMs - d.firstMs) / 3600000).toFixed(2),
              activities: d.count,
            })),
        };
      }).sort((a, b) => b.closings - a.closings || b.firstChats - a.firstChats);

      const leaderboard = frInScopeIds.map((id) => {
        const s = fr[id];
        const firstList = s.firstRespSecList;
        const green = firstList.filter((sec) => sec <= greenS).length;
        return {
          name: nameById[id] || "Agent",
          closings: s.closings,
          firstChats: s.firstChats,
          slaPct: firstList.length ? Math.round((green / firstList.length) * 100) : 0,
        };
      }).filter((a) => a.closings > 0 || a.firstChats > 0)
        .sort((a, b) => b.closings - a.closings || b.slaPct - a.slaPct)
        .slice(0, 10);

      // Invitation KPIs — filter dari FR, opsional per agent tertentu.
      const invScoped = invSent.filter((i) => {
        if (!frUserIds.has(i.from_user_id)) return false;
        if (selectedAgent && i.from_user_id !== selectedAgent) return false;
        return true;
      });
      const invSentTotal = invScoped.length;
      const invAcceptedNonFR = invScoped.filter(
        (i) => i.status === "accepted" && !frUserIds.has(i.to_user_id),
      ).length;
      const invRejected = invScoped.filter((i) => i.status === "rejected").length;
      const invPending = invScoped.filter((i) => i.status === "pending").length;

      setData({
        newLeads, answered: answeredContacts.size, totalResp, avgSec,
        avgFirstRespSec, unresponded, slaCount, slaPct, hourBuckets,
        totalFirst, totalContinue, totalClosing, totalShare, avgHandle,
        hourlyData, trend, leaderboard, frAgents,
        invSentTotal, invAcceptedNonFR, invRejected, invPending,
      });
    })();
  }, [startISO, endISO, slaGreen, slaYellow, profiles, selectedAgent, frUserIds]);

  if (!data) return <div className="text-muted-foreground py-10 text-center">Memuat...</div>;
  const fmtTime = (s: number) => !s ? "—" : s < 60 ? `${s}d` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}d` : `${Math.floor(s / 3600)}j ${Math.floor((s % 3600) / 60)}m`;
  const slaPie = [
    { name: `Hijau (<${slaGreen}m)`, value: data.slaCount.green, fill: "#10b981" },
    { name: `Kuning (${slaGreen}-${slaYellow}m)`, value: data.slaCount.yellow, fill: "#f59e0b" },
    { name: `Merah (>${slaYellow}m)`, value: data.slaCount.red, fill: "#ef4444" },
  ];

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI icon={MessageCircle} label="Total First Response" value={data.totalFirst} color="text-emerald-500"
          hint="Jumlah lead baru yang pertama kali dijawab oleh agent FR." />
        <KPI icon={ArrowRightLeft} label="Continue Conversation" value={data.totalContinue} color="text-amber-500"
          hint="Berapa kali agent FR melanjutkan chat yang sebelumnya dipegang FR lain." />
        <KPI icon={CheckCircle2} label="Total Closing" value={data.totalClosing} color="text-primary"
          hint="Jumlah invitation yang dikirim FR & diterima agent non-FR (dihitung untuk pengirim invitation)." />
        <KPI icon={Trophy} label="Closing Share" value={data.totalShare} color="text-fuchsia-500"
          hint="Porsi closing yang dibagi rata jika >1 FR menangani lead sebelum invitation. Solo handler tidak dapat share." />
        <KPI icon={Timer} label="Avg First Response" value={fmtTime(data.avgFirstRespSec)} color="text-emerald-500"
          hint="Rata-rata waktu dari lead masuk sampai balasan pertama FR." />
        <KPI icon={Clock} label="Avg Handle Time" value={fmtTime(data.avgHandle)} color="text-blue-500"
          hint="Rata-rata durasi dari balasan pertama FR sampai invitation closing diterima. Dihitung untuk semua FR yang ikut menangani lead tsb." />
        {!selectedAgent && (
          <KPI icon={MessageCircle} label="Leads Baru" value={data.newLeads} color="text-blue-500"
            hint="Jumlah kontak baru yang masuk pada rentang tanggal terpilih." />
        )}
        <KPI icon={UserCheck} label="Sudah Dijawab" value={data.answered} color="text-emerald-500"
          hint="Jumlah unik lead yang setidaknya sudah dibalas 1x oleh FR." />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KPI icon={Timer} label="Avg Respon" value={fmtTime(data.avgSec)} color="text-primary"
          hint="Rata-rata waktu balas FR untuk setiap pesan masuk (bukan hanya yang pertama)." />
        <KPI icon={AlertTriangle} label="Belum Dijawab" value={data.unresponded} color="text-rose-500"
          hint="Percakapan dengan pesan masuk yang belum dibaca / dibalas." />
        <KPI icon={Zap} label="SLA Hijau %" value={`${data.slaPct}%`} color="text-emerald-500"
          hint={`Persentase first response yang dijawab ≤ ${slaGreen} menit.`} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI icon={ArrowRightLeft} label="Invitation Dikirim" value={data.invSentTotal} color="text-primary"
          hint="Total invitation yang dikirim FR untuk mengoper lead ke agent lain." />
        <KPI icon={CheckCircle2} label="Diterima (non-FR)" value={data.invAcceptedNonFR} color="text-emerald-500"
          hint="Invitation yang diterima oleh agent di luar divisi First Response — dihitung sebagai closing." />
        <KPI icon={AlertTriangle} label="Ditolak" value={data.invRejected} color="text-rose-500"
          hint="Invitation yang ditolak oleh agent tujuan." />
        <KPI icon={Clock} label="Pending" value={data.invPending} color="text-amber-500"
          hint="Invitation yang masih menunggu respon dari agent tujuan." />
      </div>


      <Card className="glow-soft">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Clock className="size-4" /> Distribusi Waktu First Response</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-4">
            {data.hourBuckets.map((b: any, i: number) => (
              <div key={b.label} className="rounded-xl border p-3 text-center bg-card">
                <div className="text-2xl font-bold" style={{ color: BUCKET_COLORS[i] }}>{b.count}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{b.label}</div>
              </div>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.hourBuckets}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="label" fontSize={11} />
              <YAxis fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} wrapperStyle={tooltipWrapperStyle} cursor={tooltipCursor} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {data.hourBuckets.map((_: any, i: number) => <Cell key={i} fill={BUCKET_COLORS[i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="glow-soft">
          <CardHeader><CardTitle className="text-base">SLA Breakdown</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {slaPie.map((s) => (
                <div key={s.name} className="rounded-xl border p-3 text-center">
                  <div className="text-2xl font-bold" style={{ color: s.fill }}>{s.value}</div>
                  <div className="text-[11px] text-muted-foreground">{s.name}</div>
                </div>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={slaPie}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} wrapperStyle={tooltipWrapperStyle} cursor={tooltipCursor} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {slaPie.map((s, i) => <Cell key={i} fill={s.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="glow-soft">
          <CardHeader><CardTitle className="text-base">Beban Per Jam (Leads Baru)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.hourlyData}>
                <defs>
                  <linearGradient id="hourGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} wrapperStyle={tooltipWrapperStyle} cursor={tooltipCursor} />
                <Area type="monotone" dataKey="count" stroke="hsl(var(--primary))" fill="url(#hourGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="glow-soft">
        <CardHeader><CardTitle className="text-base">Tren Harian: Leads Baru vs Direspon</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data.trend}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} wrapperStyle={tooltipWrapperStyle} cursor={tooltipCursor} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="leads" name="Leads Baru" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.25} />
              <Area type="monotone" dataKey="responded" name="Direspon" stroke="#10b981" fill="#10b981" fillOpacity={0.25} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="glow-soft">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Trophy className="size-4" /> Leaderboard First Response</CardTitle></CardHeader>
        <CardContent>
          <p className="text-[11px] text-muted-foreground mb-2">Diranking berdasarkan Total Closing, tie-break SLA%.</p>
          {data.leaderboard.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">Belum ada data.</div>
          ) : (
            <div className="space-y-2">
              {data.leaderboard.map((a: any, i: number) => (
                <div key={a.name} className="flex items-center gap-3 rounded-xl border p-3">
                  <div className="size-8 grid place-items-center rounded-lg bg-primary/10 text-primary font-semibold">{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{a.name}</div>
                    <div className="text-[11px] text-muted-foreground">{a.closings} closing · {a.firstChats} first resp.</div>
                  </div>
                  <Badge className={a.slaPct >= 80 ? "bg-emerald-500/15 text-emerald-500" : a.slaPct >= 50 ? "bg-amber-500/15 text-amber-500" : "bg-rose-500/15 text-rose-500"}>
                    {a.slaPct}% SLA
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glow-soft">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="size-4" /> Detail Tim First Response (Historis)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(!data.frAgents || data.frAgents.length === 0) ? (
            <div className="text-sm text-muted-foreground text-center py-8">Belum ada agent First Response.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-muted-foreground border-b">
                    <th className="py-2 pr-3">Agent</th>
                    <th className="py-2 pr-3 text-right">First Resp.</th>
                    <th className="py-2 pr-3 text-right">Continue</th>
                    <th className="py-2 pr-3 text-right">Closing</th>
                    <th className="py-2 pr-3 text-right">Closing Share</th>
                    <th className="py-2 pr-3 text-right">Avg First Resp.</th>
                    <th className="py-2 pr-3 text-right">Avg Resp.</th>
                    <th className="py-2 pr-3 text-right">Avg Handle</th>
                    <th className="py-2 pr-3 text-right">Hari Aktif</th>
                    <th className="py-2 pr-3 text-right">Avg Jam Kerja/Hari</th>
                  </tr>
                </thead>
                <tbody>
                  {data.frAgents.map((a: any) => (
                    <tr key={a.id} className="border-b last:border-0 hover:bg-accent/30">
                      <td className="py-2 pr-3 font-medium">{a.name}</td>
                      <td className="py-2 pr-3 text-right"><Badge className="bg-emerald-500/15 text-emerald-500 font-mono">{a.firstChats}</Badge></td>
                      <td className="py-2 pr-3 text-right"><Badge className="bg-amber-500/15 text-amber-500 font-mono">{a.continuedFromOther}</Badge></td>
                      <td className="py-2 pr-3 text-right"><Badge className="bg-primary/15 text-primary font-mono">{a.closings}</Badge></td>
                      <td className="py-2 pr-3 text-right"><Badge className="bg-fuchsia-500/15 text-fuchsia-500 font-mono">{a.closingShare.toFixed(2)}</Badge></td>
                      <td className="py-2 pr-3 text-right font-mono">{a.avgFirstRespSec ? fmtTime(a.avgFirstRespSec) : "-"}</td>
                      <td className="py-2 pr-3 text-right font-mono">{a.avgRespSec ? fmtTime(a.avgRespSec) : "-"}</td>
                      <td className="py-2 pr-3 text-right font-mono">{a.avgHandleSec ? fmtTime(a.avgHandleSec) : "-"}</td>
                      <td className="py-2 pr-3 text-right font-mono">{a.daysActive}</td>
                      <td className="py-2 pr-3 text-right font-mono">{a.avgWorkHours > 0 ? `${a.avgWorkHours.toFixed(2)} j` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glow-soft">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="size-4" /> Rincian Jam Kerja Harian
          </CardTitle>
          <p className="text-[11px] text-muted-foreground mt-1">
            Dihitung dari log aktivitas (chat, ganti stage, assign). Jam kerja = selisih aktivitas pertama dan terakhir di hari tersebut.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {(!data.frAgents || data.frAgents.length === 0) ? (
            <div className="text-sm text-muted-foreground text-center py-6">Tidak ada data aktivitas pada rentang ini.</div>
          ) : (
            data.frAgents.map((a: any) => (
              <details key={a.id} className="border rounded-lg" open={data.frAgents.length <= 3}>
                <summary className="cursor-pointer px-3 py-2 flex flex-wrap items-center justify-between gap-2 hover:bg-accent/30 rounded-lg">
                  <span className="font-medium text-sm">{a.name}</span>
                  <span className="text-xs text-muted-foreground font-mono">
                    {a.daysActive} hari · Avg {a.avgWorkHours.toFixed(2)} j/hari
                  </span>
                </summary>
                {a.dailyWork.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground">Tidak ada aktivitas.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] text-muted-foreground border-b border-t bg-muted/30">
                          <th className="py-1.5 px-3">Tanggal</th>
                          <th className="py-1.5 px-3">Mulai</th>
                          <th className="py-1.5 px-3">Selesai</th>
                          <th className="py-1.5 px-3 text-right">Jam Kerja</th>
                          <th className="py-1.5 px-3 text-right">Aktivitas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.dailyWork.map((d: any) => {
                          const start = new Date(d.startMs);
                          const end = new Date(d.endMs);
                          const dayName = start.toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "short", year: "numeric" });
                          const timeFmt = (dt: Date) => dt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
                          return (
                            <tr key={d.date} className="border-b last:border-0 hover:bg-accent/20">
                              <td className="py-1.5 px-3">{dayName}</td>
                              <td className="py-1.5 px-3 font-mono">{timeFmt(start)}</td>
                              <td className="py-1.5 px-3 font-mono">{timeFmt(end)}</td>
                              <td className="py-1.5 px-3 text-right font-mono">{d.hours.toFixed(2)} j</td>
                              <td className="py-1.5 px-3 text-right font-mono">{d.activities}</td>
                            </tr>
                          );
                        })}
                        <tr className="bg-muted/40 font-medium">
                          <td className="py-1.5 px-3" colSpan={3}>Total</td>
                          <td className="py-1.5 px-3 text-right font-mono">
                            {a.dailyWork.reduce((s: number, d: any) => s + d.hours, 0).toFixed(2)} j
                          </td>
                          <td className="py-1.5 px-3 text-right font-mono">
                            {a.dailyWork.reduce((s: number, d: any) => s + d.activities, 0)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </details>
            ))
          )}
        </CardContent>
      </Card>
    </>
  );
}


/* ============================== PERFORMANCE ============================== */

function PerformanceTab({ startISO, endISO, profiles, scopeIds }: {
  startISO: string; endISO: string; profiles: Profile[]; scopeIds: Set<string> | null;
}) {
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: events }, { data: stages }] = await Promise.all([
        supabase.from("audit_events")
          .select("event_type, actor_id, contact_id, new_value, occurred_at")
          .gte("occurred_at", startISO).lte("occurred_at", endISO).limit(20000),
        supabase.from("stages").select("id, name, order_index").order("order_index"),
      ]);

      const evs = (events || []) as any[];
      const wonStageIds = new Set((stages || []).filter((s: any) => ["Closed Won", "Treatment"].includes(s.name)).map((s: any) => s.id));

      const firstIn: Record<string, number> = {};
      const responses: Record<string, { total: number; count: number; buckets: number[] }> = {};
      evs.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
      for (const e of evs) {
        if (e.event_type === "chat_in" && !firstIn[e.contact_id]) {
          firstIn[e.contact_id] = new Date(e.occurred_at).getTime();
        } else if (e.event_type === "chat_out" && firstIn[e.contact_id] && e.actor_id) {
          const sec = Math.max(0, Math.round((new Date(e.occurred_at).getTime() - firstIn[e.contact_id]) / 1000));
          responses[e.actor_id] = responses[e.actor_id] || { total: 0, count: 0, buckets: HOUR_BUCKETS.map(() => 0) };
          responses[e.actor_id].total += sec;
          responses[e.actor_id].count++;
          responses[e.actor_id].buckets[bucketIdx(sec)]++;
          delete firstIn[e.contact_id];
        }
      }

      const perAgent: Record<string, any> = {};
      const ensure = (id: string) => {
        if (!perAgent[id]) {
          const p = profiles.find((x) => x.id === id);
          perAgent[id] = {
            id, name: p?.full_name || p?.email || "Tidak dikenal",
            division: p?.position || "—",
            outbound: 0, won: 0, avgResp: 0, respCount: 0,
            buckets: HOUR_BUCKETS.map(() => 0),
          };
        }
        return perAgent[id];
      };

      evs.forEach((e) => {
        if (!e.actor_id) return;
        if (scopeIds && !scopeIds.has(e.actor_id)) return;
        const a = ensure(e.actor_id);
        if (e.event_type === "chat_out") a.outbound++;
        else if (e.event_type === "stage_changed") {
          const newId = e.new_value?.stage_id;
          if (newId && wonStageIds.has(newId)) a.won++;
        }
      });

      Object.entries(responses).forEach(([id, r]) => {
        if (scopeIds && !scopeIds.has(id)) return;
        const a = ensure(id);
        a.avgResp = Math.round(r.total / r.count);
        a.respCount = r.count;
        a.buckets = r.buckets;
        HOUR_BUCKETS.forEach((b, i) => { a[b.label] = r.buckets[i]; });
      });

      setRows(Object.values(perAgent).sort((a: any, b: any) => b.outbound - a.outbound));
    })();
  }, [startISO, endISO, profiles, scopeIds]);

  const fmtTime = (s: number) => !s ? "-" : s < 60 ? `${s}d` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}j ${Math.floor((s % 3600) / 60)}m`;
  const chartData = rows.slice(0, 10).map((r) => ({ name: r.name.split(" ")[0], Reply: r.outbound, Won: r.won }));

  return (
    <>
      <Card className="glow-soft">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Trophy className="size-4" /> Top Agent — Aktivitas</CardTitle></CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">Belum ada data.</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} wrapperStyle={tooltipWrapperStyle} cursor={tooltipCursor} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Reply" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Won" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="glow-soft">
        <CardHeader>
          <CardTitle className="text-base">Sebaran Waktu Respon per Agent (jam, stacked)</CardTitle>
          <p className="text-xs text-muted-foreground">Komposisi cepat (hijau) → lambat (merah) per agent.</p>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">Belum ada data.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 38)}>
              <BarChart data={rows} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis type="number" fontSize={11} allowDecimals={false} />
                <YAxis type="category" dataKey="name" fontSize={11} width={100} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} wrapperStyle={tooltipWrapperStyle} cursor={tooltipCursor} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {HOUR_BUCKETS.map((b, i) => (
                  <Bar key={b.label} dataKey={b.label} stackId="a" fill={BUCKET_COLORS[i]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="glow-soft">
        <CardHeader><CardTitle className="text-base">Detail per Agent</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left py-2 px-2">Agent</th>
                <th className="text-left py-2 px-2">Divisi</th>
                <th className="text-right py-2 px-2"><MessageSquare className="size-3 inline" /> Chat</th>
                <th className="text-right py-2 px-2"><CheckCircle2 className="size-3 inline" /> Closing</th>
                <th className="text-right py-2 px-2"><Clock className="size-3 inline" /> Avg Respon</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">Belum ada aktivitas pada rentang ini.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="py-2 px-2 font-medium">{r.name}</td>
                  <td className="py-2 px-2 text-xs text-muted-foreground">{r.division}</td>
                  <td className="py-2 px-2 text-right">{r.outbound}</td>
                  <td className="py-2 px-2 text-right">
                    {r.won > 0 ? <Badge className="bg-emerald-500/15 text-emerald-500">{r.won}</Badge> : <span className="text-muted-foreground">0</span>}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs">{fmtTime(r.avgResp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}

/* ============================== SHARED ============================== */

const tooltipStyle = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 10,
  padding: "8px 10px",
  boxShadow: "0 10px 30px -10px rgba(0,0,0,.35)",
  color: "hsl(var(--popover-foreground))",
  fontSize: 12,
  lineHeight: 1.35,
} as const;
const tooltipLabelStyle = { color: "hsl(var(--foreground))", fontWeight: 600, marginBottom: 4 } as const;
const tooltipItemStyle = { color: "hsl(var(--popover-foreground))", padding: "1px 0" } as const;
const tooltipWrapperStyle = { zIndex: 60, outline: "none" } as const;
const tooltipCursor = { fill: "hsl(var(--accent))", opacity: 0.18 } as const;

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: any }) {
  return (
    <Card className="glow-soft">
      <CardContent className="p-4 flex items-center gap-3">
        <div className="size-10 rounded-lg bg-primary/15 text-primary grid place-items-center glow-primary">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground">{label}</div>
          <div className="text-lg font-bold truncate">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function KPI({ icon: Icon, label, value, color, hint }: any) {
  return (
    <Card className="glow-soft">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className={`size-4 ${color}`} />
        </div>
        <div className="text-xl md:text-2xl font-bold">{value}</div>
        {hint && <div className="text-[10px] text-muted-foreground mt-1 leading-snug">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function AgentDetailDialog({ agent, contactMap, onClose }: { agent: any; contactMap: Record<string, any>; onClose: () => void }) {
  return (
    <Dialog open={!!agent} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserCheck className="size-5" /> {agent?.name}</DialogTitle>
        </DialogHeader>
        {agent && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border p-3"><div className="text-[11px] text-muted-foreground">Historis (unik)</div><div className="text-xl font-bold">{agent.historicalUnique}</div></div>
              <div className="rounded-lg border p-3"><div className="text-[11px] text-muted-foreground">Total Assign</div><div className="text-xl font-bold">{agent.historicalTotal}</div></div>
              <div className="rounded-lg border p-3"><div className="text-[11px] text-muted-foreground">Sedang dipegang</div><div className="text-xl font-bold">{agent.currentCount}</div></div>
            </div>
            <div>
              <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><InboxIcon className="size-4" /> Lead aktif ({agent.currentList.length})</h4>
              {agent.currentList.length === 0 ? (
                <p className="text-xs text-muted-foreground">Tidak ada lead aktif.</p>
              ) : (
                <div className="space-y-1.5">
                  {agent.currentList.map((c: any) => (
                    <Link key={c.conversation_id} to="/inbox" search={{ c: c.conversation_id } as any}
                      className="flex items-center gap-2 p-2 rounded-md border hover:bg-accent/40 text-xs">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{c.full_name || c.whatsapp_number || "—"}</div>
                        <div className="text-muted-foreground truncate">{c.last_message_preview || "—"}</div>
                      </div>
                      {c.stage && <Badge style={{ background: c.stage_color, color: "#fff" }} className="text-[10px]">{c.stage}</Badge>}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><History className="size-4" /> Pernah di-assign ({agent.historicalContactIds.length})</h4>
              {agent.historicalContactIds.length === 0 ? (
                <p className="text-xs text-muted-foreground">Belum ada riwayat.</p>
              ) : (
                <div className="space-y-1.5">
                  {agent.historicalContactIds.map((cid: string) => {
                    const c = contactMap[cid];
                    if (!c) return null;
                    return (
                      <div key={cid} className="flex items-center gap-2 p-2 rounded-md border text-xs">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{c.full_name || c.whatsapp_number || "—"}</div>
                          <div className="text-muted-foreground truncate">{c.whatsapp_number}</div>
                        </div>
                        {c.stages?.name && <Badge style={{ background: c.stages.color, color: "#fff" }} className="text-[10px]">{c.stages.name}</Badge>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
