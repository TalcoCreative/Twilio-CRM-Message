import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { formatDistanceToNow } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { MessageSquare, Inbox as InboxIcon, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/invitations")({
  head: () => ({ meta: [{ title: "Invitation — Husada CRM" }] }),
  component: InvitationsListPage,
});

function InvitationsListPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"incoming" | "outgoing">("incoming");
  const [rows, setRows] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState<null | "accept" | "reject">(null);
  const [ack, setAck] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!user) return;
    const col = tab === "incoming" ? "to_user_id" : "from_user_id";
    const { data } = await supabase.from("assignment_invitations")
      .select("id, status, created_at, responded_at, note, reject_reason, contact_id, conversation_id, from_user_id, to_user_id, previous_stage_id")
      .eq(col, user.id).order("created_at", { ascending: false }).limit(200);
    const invs = (data as any[]) || [];
    setRows(invs);
    setSelected((prev) => prev.filter((id) => invs.some((i) => i.id === id && i.status === "pending")));
    // Enrich with contact + profile names
    const contactIds = Array.from(new Set(invs.map((i) => i.contact_id)));
    const userIds = Array.from(new Set(invs.flatMap((i) => [i.from_user_id, i.to_user_id])));
    const [{ data: ct }, { data: pf }] = await Promise.all([
      contactIds.length ? supabase.from("contacts").select("id, full_name, whatsapp_number").in("id", contactIds) : Promise.resolve({ data: [] as any[] }),
      userIds.length ? supabase.from("profiles").select("id, full_name, email").in("id", userIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const map: Record<string, any> = {};
    ((ct as any[]) || []).forEach((c) => { map["c:" + c.id] = c; });
    ((pf as any[]) || []).forEach((p) => { map["u:" + p.id] = p; });
    setProfiles(map);
  }
  useEffect(() => { load(); }, [user?.id, tab]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel("invitations-list-" + user.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "assignment_invitations" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, tab]);

  const pendingRows = useMemo(
    () => (tab === "incoming" ? rows.filter((r) => r.status === "pending") : []),
    [rows, tab],
  );
  const allSelected = pendingRows.length > 0 && selected.length === pendingRows.length;
  const selectedRows = useMemo(() => rows.filter((r) => selected.includes(r.id)), [rows, selected]);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function openAction(a: "accept" | "reject") {
    setAck(false);
    setReason("");
    setAction(a);
  }

  async function runBulk() {
    if (!user || selectedRows.length === 0) return;
    if (action === "reject" && !reason.trim()) { toast.error("Wajib isi alasan penolakan."); return; }
    setBusy(true);
    let ok = 0, fail = 0;
    for (const inv of selectedRows) {
      try {
        if (action === "accept") {
          const [{ error: e1 }, { error: e2 }] = await Promise.all([
            supabase.from("conversations").update({ assigned_agent_id: user.id }).eq("id", inv.conversation_id),
            supabase.from("contacts").update({ assigned_agent_id: user.id }).eq("id", inv.contact_id),
          ]);
          if (e1 || e2) throw (e1 || e2);
          const { error } = await supabase.from("assignment_invitations").update({
            status: "accepted", responded_at: new Date().toISOString(),
          }).eq("id", inv.id);
          if (error) throw error;
          await supabase.from("activity_logs").insert({
            user_id: user.id, action: "invitation_accepted",
            entity_type: "conversation", entity_id: inv.conversation_id,
            metadata: { invitation_id: inv.id, from_user_id: inv.from_user_id, contact_id: inv.contact_id, bulk: true },
          } as any);
        } else {
          const { error } = await supabase.from("assignment_invitations").update({
            status: "rejected", responded_at: new Date().toISOString(), reject_reason: reason.trim(),
          }).eq("id", inv.id);
          if (error) throw error;
          await supabase.from("conversations").update({ assigned_agent_id: null }).eq("id", inv.conversation_id);
          await supabase.from("contacts").update({ assigned_agent_id: null }).eq("id", inv.contact_id);
          if (inv.previous_stage_id) {
            await supabase.from("contacts").update({ stage_id: inv.previous_stage_id }).eq("id", inv.contact_id);
          }
          await supabase.from("activity_logs").insert({
            user_id: user.id, action: "invitation_rejected",
            entity_type: "conversation", entity_id: inv.conversation_id,
            metadata: { invitation_id: inv.id, reason: reason.trim(), returned_to: inv.from_user_id, bulk: true },
          } as any);
        }
        ok++;
      } catch (e: any) {
        fail++;
      }
    }
    setBusy(false);
    setAction(null);
    setSelected([]);
    if (ok) {
      toast.success(
        action === "accept"
          ? `${ok} invitation diterima. Chat sudah masuk ke My Inbox Anda.`
          : `${ok} invitation ditolak dan dikembalikan ke First Response.`,
      );
    }
    if (fail) toast.error(`${fail} invitation gagal diproses. Silakan coba lagi.`);
    load();
  }

  return (
    <div className="max-w-5xl mx-auto p-3 md:p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageSquare className="size-6 text-primary" /> Invitation
        </h1>
        <p className="text-sm text-muted-foreground">Invitation chat dari First Response yang harus Anda terima/tolak.</p>
      </header>
      <div className="flex gap-1.5 p-1.5 rounded-2xl bg-card border">
        {(["incoming", "outgoing"] as const).map((t) => (
          <button key={t} onClick={() => { setTab(t); setSelected([]); }}
            className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium transition-all ${tab === t ? "bg-primary text-primary-foreground glow-primary" : "text-foreground/70 hover:bg-accent"}`}>
            {t === "incoming" ? "Masuk (untuk Anda)" : "Dikirim (dari Anda)"}
          </button>
        ))}
      </div>

      {tab === "incoming" && pendingRows.length > 0 && (
        <Card className="border-primary/30">
          <CardContent className="p-3 flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(v) => setSelected(v ? pendingRows.map((r) => r.id) : [])}
              />
              Pilih semua yang pending ({pendingRows.length})
            </label>
            <div className="flex-1" />
            <span className="text-xs text-muted-foreground">{selected.length} dipilih</span>
            <Button size="sm" disabled={selected.length === 0} onClick={() => openAction("accept")}
              className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <CheckCircle2 className="size-4 mr-1.5" /> Terima Terpilih
            </Button>
            <Button size="sm" variant="destructive" disabled={selected.length === 0} onClick={() => openAction("reject")}>
              <XCircle className="size-4 mr-1.5" /> Tolak Terpilih
            </Button>
          </CardContent>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          <InboxIcon className="size-8 mx-auto mb-2 opacity-40" />
          Belum ada invitation.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const ct = profiles["c:" + r.contact_id];
            const from = profiles["u:" + r.from_user_id];
            const to = profiles["u:" + r.to_user_id];
            const selectable = tab === "incoming" && r.status === "pending";
            const badge =
              r.status === "pending" ? "bg-amber-500/15 text-amber-600" :
              r.status === "accepted" ? "bg-emerald-500/15 text-emerald-600" :
              r.status === "rejected" ? "bg-rose-500/15 text-rose-600" :
              "bg-muted text-muted-foreground";
            return (
              <Card key={r.id} className="hover:bg-accent/30 transition-colors">
                <CardContent className="p-3 flex items-center gap-3 flex-wrap">
                  {selectable && (
                    <Checkbox
                      className="shrink-0"
                      checked={selected.includes(r.id)}
                      onCheckedChange={() => toggle(r.id)}
                      aria-label="Pilih invitation"
                    />
                  )}
                  <Link to="/invitation/$id" params={{ id: r.id }} className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{ct?.full_name || ct?.whatsapp_number || "Kontak"}</span>
                      <Badge className={badge}>{r.status}</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {tab === "incoming"
                        ? <>Dari <b>{from?.full_name || from?.email?.split("@")[0]}</b></>
                        : <>Untuk <b>{to?.full_name || to?.email?.split("@")[0]}</b></>}
                      {" · "}{formatDistanceToNow(new Date(r.created_at), { addSuffix: true, locale: idLocale })}
                    </div>
                    {r.note && <div className="text-xs text-foreground/80 mt-1 line-clamp-1 italic">"{r.note}"</div>}
                    {r.reject_reason && <div className="text-xs text-rose-600 mt-1 line-clamp-1">Ditolak: {r.reject_reason}</div>}
                  </Link>
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/invitation/$id" params={{ id: r.id }}>Buka</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!action} onOpenChange={(v) => { if (!v && !busy) setAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {action === "accept"
                ? `Terima ${selected.length} invitation sekaligus?`
                : `Tolak ${selected.length} invitation sekaligus?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {action === "accept"
                    ? "Semua chat yang Anda pilih akan langsung berpindah menjadi tanggung jawab Anda dan masuk ke My Inbox. Tindakan ini tidak bisa dibatalkan sendiri oleh First Response."
                    : "Semua chat yang Anda pilih akan dikembalikan ke First Response pengirim, penugasan agent dilepas, dan stage lead dikembalikan ke posisi sebelumnya."}
                </p>
                <p className="font-medium text-foreground">
                  Pastikan Anda sudah membuka dan membaca isi percakapan pada setiap invitation di bawah ini sebelum melanjutkan.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="max-h-40 overflow-auto rounded-lg border bg-muted/30 p-2 space-y-1 text-xs">
            {selectedRows.map((r) => {
              const ct = profiles["c:" + r.contact_id];
              return (
                <div key={r.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{ct?.full_name || ct?.whatsapp_number || "Kontak"}</span>
                  <span className="text-muted-foreground font-mono text-[10px] shrink-0">{ct?.whatsapp_number}</span>
                </div>
              );
            })}
          </div>

          {action === "reject" && (
            <div className="space-y-1">
              <label className="text-xs font-medium">Alasan penolakan (wajib, dipakai untuk semua yang dipilih)</label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="cth: keluhan belum jelas, data pasien belum lengkap, dsb." />
            </div>
          )}

          <label className="flex items-start gap-2 text-sm cursor-pointer rounded-lg border p-3">
            <Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} className="mt-0.5" />
            <span>
              Saya menyatakan sudah <b>melihat dan membaca seluruh percakapan</b> pada {selected.length} invitation yang saya pilih, dan sadar keputusan ini akan langsung diterapkan ke semuanya.
            </span>
          </label>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Batal, saya cek dulu</AlertDialogCancel>
            <AlertDialogAction
              disabled={!ack || busy || (action === "reject" && !reason.trim())}
              onClick={(e) => { e.preventDefault(); runBulk(); }}
              className={action === "reject" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-emerald-600 hover:bg-emerald-700 text-white"}
            >
              {busy && <Loader2 className="size-4 mr-2 animate-spin" />}
              {action === "accept" ? "Ya, terima semuanya" : "Ya, tolak semuanya"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
