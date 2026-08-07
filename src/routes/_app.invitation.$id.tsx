import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, CheckCircle2, XCircle, MessageSquare, ArrowLeft, User as UserIcon, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/invitation/$id")({
  head: () => ({ meta: [{ title: "Invitation — Husada CRM" }] }),
  component: InvitationPage,
});

function InvitationPage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const router = useRouter();
  const [inv, setInv] = useState<any>(null);
  const [contact, setContact] = useState<any>(null);
  const [conversation, setConversation] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [fromName, setFromName] = useState<string>("");
  const [stage, setStage] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data: invRow, error } = await supabase.from("assignment_invitations").select("*").eq("id", id).maybeSingle();
    if (error || !invRow) { toast.error("Invitation tidak ditemukan"); router.navigate({ to: "/inbox", search: { c: undefined } }); return; }
    setInv(invRow);
    const snapshotAt = (invRow as any).snapshot_at || invRow.created_at;
    const [{ data: c }, { data: conv }, { data: msgs }, { data: fromProf }, { data: st }] = await Promise.all([
      supabase.from("contacts").select("*").eq("id", invRow.contact_id).maybeSingle(),
      supabase.from("conversations").select("*").eq("id", invRow.conversation_id).maybeSingle(),
      supabase.from("messages").select("*").eq("conversation_id", invRow.conversation_id).lte("sent_at", snapshotAt).order("sent_at", { ascending: true }),
      supabase.from("profiles").select("full_name,email").eq("id", invRow.from_user_id).maybeSingle(),
      invRow.previous_stage_id
        ? supabase.from("stages").select("name,color").eq("id", invRow.previous_stage_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setContact(c);
    setConversation(conv);
    setMessages(msgs || []);
    setFromName(fromProf?.full_name || fromProf?.email?.split("@")[0] || "First Response");
    setStage(st);
    setLoading(false);
  }
  useEffect(() => { load(); }, [id]);

  const isRecipient = user?.id && inv?.to_user_id === user.id;
  const isSender = user?.id && inv?.from_user_id === user.id;

  async function accept() {
    if (!inv || !user) return;
    setBusy(true);
    // Assign conversation & contact to me
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from("conversations").update({ assigned_agent_id: user.id }).eq("id", inv.conversation_id),
      supabase.from("contacts").update({ assigned_agent_id: user.id }).eq("id", inv.contact_id),
    ]);
    if (e1 || e2) { setBusy(false); toast.error((e1 || e2)!.message); return; }
    const { error } = await supabase.from("assignment_invitations").update({
      status: "accepted", responded_at: new Date().toISOString(),
    }).eq("id", inv.id);
    if (error) { setBusy(false); toast.error(error.message); return; }
    await supabase.from("activity_logs").insert({
      user_id: user.id, action: "invitation_accepted",
      entity_type: "conversation", entity_id: inv.conversation_id,
      metadata: { invitation_id: inv.id, from_user_id: inv.from_user_id, contact_id: inv.contact_id },
    } as any);
    toast.success("Penugasan diterima. Chat masuk ke My Inbox.");
    router.navigate({ to: "/inbox", search: { c: inv.conversation_id } });
  }

  async function reject() {
    if (!inv || !user) return;
    if (!rejectReason.trim()) { toast.error("Wajib isi alasan penolakan."); return; }
    setBusy(true);
    const patch: any = {
      status: "rejected",
      responded_at: new Date().toISOString(),
      reject_reason: rejectReason.trim(),
    };
    const { error } = await supabase.from("assignment_invitations").update(patch).eq("id", inv.id);
    if (error) { setBusy(false); toast.error(error.message); return; }
    // Rollback: lead balik ke FR yang ngundang; assigned_agent_id kosongkan, stage kembali ke previous
    await supabase.from("conversations").update({ assigned_agent_id: null }).eq("id", inv.conversation_id);
    await supabase.from("contacts").update({ assigned_agent_id: null }).eq("id", inv.contact_id);
    if (inv.previous_stage_id) {
      await supabase.from("contacts").update({ stage_id: inv.previous_stage_id }).eq("id", inv.contact_id);
    }
    await supabase.from("activity_logs").insert({
      user_id: user.id, action: "invitation_rejected",
      entity_type: "conversation", entity_id: inv.conversation_id,
      metadata: { invitation_id: inv.id, reason: rejectReason.trim(), returned_to: inv.from_user_id },
    } as any);
    toast.success("Invitation ditolak. Lead dikembalikan ke First Response.");
    setBusy(false);
    load();
  }

  async function cancel() {
    if (!inv || !user) return;
    setBusy(true);
    const { error } = await supabase.from("assignment_invitations").update({
      status: "cancelled", responded_at: new Date().toISOString(),
    }).eq("id", inv.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Invitation dibatalkan.");
    load();
  }

  if (loading || !inv) return <div className="p-8 text-center text-muted-foreground">Memuat…</div>;

  const statusColor =
    inv.status === "pending" ? "bg-amber-500/15 text-amber-600" :
    inv.status === "accepted" ? "bg-emerald-500/15 text-emerald-600" :
    inv.status === "rejected" ? "bg-rose-500/15 text-rose-600" :
    "bg-muted text-muted-foreground";

  return (
    <div className="max-w-4xl mx-auto p-3 md:p-6 space-y-4">
      <Link to="/inbox" search={{ c: undefined }} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Kembali ke Inbox
      </Link>

      <Card className="glow-soft">
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="size-5 text-primary" />
                Invitation Penugasan
              </CardTitle>
              <CardDescription className="mt-1">
                Dari <b>{fromName}</b> untuk <b>{contact?.full_name || contact?.whatsapp_number}</b>
              </CardDescription>
            </div>
            <Badge className={statusColor}>{inv.status.toUpperCase()}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="rounded-lg border p-2">
              <div className="text-muted-foreground">Kontak</div>
              <div className="font-medium">{contact?.full_name || "—"}</div>
              <div className="text-[10px] text-muted-foreground font-mono">{contact?.whatsapp_number}</div>
            </div>
            <div className="rounded-lg border p-2">
              <div className="text-muted-foreground">Stage sebelumnya</div>
              <div className="font-medium">{stage?.name || "—"}</div>
            </div>
            <div className="rounded-lg border p-2">
              <div className="text-muted-foreground">Domisili</div>
              <div className="font-medium">{contact?.domicile || "—"}</div>
            </div>
            <div className="rounded-lg border p-2 flex items-center gap-1.5">
              <Clock className="size-3 text-muted-foreground" />
              <div>
                <div className="text-muted-foreground">Diundang</div>
                <div className="font-medium">{new Date(inv.created_at).toLocaleString("id-ID")}</div>
              </div>
            </div>
          </div>
          {contact?.chief_complaint && (
            <div className="rounded-lg border p-3 bg-muted/30 text-xs">
              <div className="text-[10px] text-muted-foreground mb-1">Keluhan</div>
              <div className="italic">{contact.chief_complaint}</div>
            </div>
          )}
          {inv.note && (
            <div className="rounded-lg border-l-4 border-primary bg-primary/5 p-3 text-sm">
              <div className="text-[10px] font-semibold text-primary mb-1">Catatan dari {fromName}</div>
              {inv.note}
            </div>
          )}
          {inv.reject_reason && (
            <div className="rounded-lg border-l-4 border-rose-500 bg-rose-500/5 p-3 text-sm">
              <div className="text-[10px] font-semibold text-rose-600 mb-1">Alasan penolakan</div>
              {inv.reject_reason}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glow-soft">
        <CardHeader>
          <CardTitle className="text-base">Riwayat Chat saat di-invite (read-only)</CardTitle>
          <CardDescription>Hanya menampilkan chat sampai waktu invitation dikirim. Baca dulu sebelum menerima — kalau belum layak follow-up, tolak dengan alasan.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[420px] overflow-auto space-y-2 bg-muted/30 rounded-lg p-3 border">
            {messages.length === 0 && <div className="text-xs text-muted-foreground text-center py-6">Belum ada pesan.</div>}
            {messages.map((m) => {
              if (m.type === "INTERNAL_NOTE") {
                return (
                  <div key={m.id} className="text-[11px] italic text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-400/40 rounded px-2 py-1">
                    📝 {m.content}
                  </div>
                );
              }
              const out = m.direction === "OUTBOUND";
              return (
                <div key={m.id} className={cn("flex", out ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[75%] rounded-xl px-3 py-2 text-sm shadow-sm whitespace-pre-wrap",
                    out ? "bg-primary/10 text-foreground border border-primary/30" : "bg-card border")}>
                    {m.content}
                    <div className="text-[10px] opacity-60 mt-1 text-right">
                      {new Date(m.sent_at).toLocaleString("id-ID", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {inv.status === "pending" && isRecipient && (
        <Card className="glow-soft">
          <CardHeader>
            <CardTitle className="text-base">Keputusan Anda</CardTitle>
            <CardDescription>Terima jika lead ini sudah layak untuk Anda follow-up. Tolak jika chat belum memenuhi requirement — lead balik ke First Response.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs font-medium">Alasan (wajib jika menolak)</label>
              <Textarea rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                placeholder="cth: keluhan belum jelas, belum ada nomor kontak, dsb." />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button onClick={accept} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {busy ? <Loader2 className="size-4 mr-2 animate-spin" /> : <CheckCircle2 className="size-4 mr-2" />}
                Terima & Ambil Alih
              </Button>
              <Button onClick={reject} disabled={busy} variant="destructive">
                {busy ? <Loader2 className="size-4 mr-2 animate-spin" /> : <XCircle className="size-4 mr-2" />}
                Tolak & Kembalikan
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {inv.status === "pending" && isSender && !isRecipient && (
        <Card>
          <CardContent className="pt-6 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <UserIcon className="size-4" /> Menunggu respon agent.
            </div>
            <Button variant="outline" onClick={cancel} disabled={busy}>Batalkan Invitation</Button>
          </CardContent>
        </Card>
      )}

      {inv.status !== "pending" && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Invitation sudah <b>{inv.status}</b> pada {inv.responded_at ? new Date(inv.responded_at).toLocaleString("id-ID") : "-"}.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
