import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Send, Search, Loader2, User as UserIcon, Tag, Zap, FileText, MoreVertical, StickyNote, MessageSquare, Trash2, Package, Smartphone, MailOpen, Paperclip, Image as ImageIcon, Film, Mic, StopCircle, Sticker, File as FileIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";

export const Route = createFileRoute("/_app/inbox")({
  head: () => ({ meta: [{ title: "Inbox — Husada CRM" }] }),
  validateSearch: (s: Record<string, unknown>) => ({ c: typeof s.c === "string" ? s.c : undefined }),
  component: () => <InboxView mineOnly={false} />,
});

export type Profile = { id: string; full_name: string | null; email: string };
export type Stage = { id: string; name: string; color: string | null };
export type Contact = {
  id: string; full_name: string | null; whatsapp_number: string;
  stage_id: string | null; interested_product_id: string | null;
  chief_complaint: string | null; domicile: string | null;
};
export type Conversation = {
  id: string; contact_id: string; status: string;
  assigned_agent_id: string | null; last_replied_by_id: string | null;
  last_message_at: string | null; last_message_preview: string | null;
  unread_count: number; contact?: Contact;
};
type MsgType = "TEXT" | "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO" | "VOICE" | "STICKER" | "INTERNAL_NOTE";
type Message = {
  id: string; conversation_id: string;
  direction: "INBOUND" | "OUTBOUND"; content: string;
  sent_at: string; sent_by_id: string | null; status: string;
  type: MsgType;
  media_url: string | null;
};
type QuickReply = { id: string; name: string; content: string; sort_order: number };
type Product = { id: string; name: string };

type ComposeMode = "reply" | "note";

export function InboxView({ mineOnly }: { mineOnly: boolean }) {
  const { user } = useAuth();
  const { isFirstResponse } = useRole();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [stages, setStages] = useState<Stage[]>([]);
  const [agents, setAgents] = useState<Profile[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [deviceLabel, setDeviceLabel] = useState<string>("");
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ComposeMode>("reply");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [domicileDraft, setDomicileDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  async function loadConversations() {
    let q = supabase
      .from("conversations")
      .select("*, contact:contacts(id, full_name, whatsapp_number, stage_id, interested_product_id, chief_complaint, domicile)")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(300);
    if (mineOnly && user) q = q.eq("assigned_agent_id", user.id);
    const { data } = await q;
    setConversations((data as any) || []);
  }

  async function loadMeta() {
    const [p, s, pr, qr, ss] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email"),
      supabase.from("stages").select("id, name, color").order("order_index"),
      supabase.from("products").select("id, name").eq("is_active", true).order("sort_order"),
      supabase.from("templates").select("id, name, content, sort_order").eq("is_quick_reply", true).order("sort_order"),
      supabase.from("system_settings").select("key,value").in("key", ["twilio_whatsapp_from", "device_label", "fonnte_device"]),
    ]);
    const pmap: Record<string, Profile> = {};
    (p.data || []).forEach((x: any) => { pmap[x.id] = x; });
    setProfiles(pmap);
    setAgents((p.data as any) || []);
    setStages((s.data as any) || []);
    setProducts((pr.data as any) || []);
    setQuickReplies((qr.data as any) || []);
    const sMap = (ss.data || []).reduce((acc: any, x: any) => { acc[x.key] = x.value; return acc; }, {});
    const label = sMap.device_label || sMap.twilio_whatsapp_from || sMap.fonnte_device;
    setDeviceLabel(label ? `WA · ${label}` : "WA");
  }

  useEffect(() => { loadConversations(); loadMeta(); }, [mineOnly, user?.id]);

  // Auto-select conversation from ?c= query param
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const c = params.get("c");
    if (c) setActiveId(c);
  }, [conversations.length]);

  // Online heartbeat — update last_seen_at every 60s
  useEffect(() => {
    if (!user) return;
    const beat = () => supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", user.id);
    beat();
    const t = setInterval(beat, 60_000);
    return () => clearInterval(t);
  }, [user?.id]);

  useEffect(() => {
    const ch = supabase.channel("inbox-all-" + (mineOnly ? "mine" : "team"))
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => loadConversations())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "contacts" }, () => loadConversations())
      .on("postgres_changes", { event: "*", schema: "public", table: "templates" }, () => loadMeta())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [mineOnly, user?.id]);

  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    (async () => {
      const { data } = await supabase.from("messages").select("*")
        .eq("conversation_id", activeId).order("sent_at", { ascending: true });
      setMessages((data as any) || []);
      await supabase.from("conversations").update({ unread_count: 0 }).eq("id", activeId);
    })();
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    const ch = supabase.channel(`messages-${activeId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${activeId}` },
        (payload) => setMessages((prev) => {
          const incoming = payload.new as Message;
          if (prev.find((m) => m.id === incoming.id)) return prev;
          // Reconcile optimistic (temp id starts with "tmp-")
          const tempIdx = prev.findIndex((m) => m.id.startsWith("tmp-") && m.content === incoming.content && m.direction === incoming.direction);
          if (tempIdx >= 0) {
            const copy = prev.slice();
            copy[tempIdx] = incoming;
            return copy;
          }
          return [...prev, incoming];
        }))
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "contacts" },
        (payload) => {
          const c: any = payload.new;
          setConversations((prev) => prev.map((cv) => cv.contact_id === c.id ? { ...cv, contact: { ...(cv.contact || {}), ...c } as any } : cv));
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const [sortBy, setSortBy] = useState<"recent" | "oldest" | "unread" | "name_asc" | "name_desc">("recent");
  const [filterUnread, setFilterUnread] = useState(false);
  const [filterUnassigned, setFilterUnassigned] = useState(false);
  const [filterStageId, setFilterStageId] = useState<string>("__all__");
  const [filterAgentId, setFilterAgentId] = useState<string>("__all__");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = conversations.filter((c) => !q ||
      c.contact?.full_name?.toLowerCase().includes(q) ||
      c.contact?.whatsapp_number?.includes(q));
    if (filterUnread) list = list.filter((c) => (c.unread_count || 0) > 0);
    if (filterUnassigned) list = list.filter((c) => !c.assigned_agent_id);
    if (filterStageId !== "__all__") {
      list = list.filter((c) => (c.contact?.stage_id || "__none__") === filterStageId);
    }
    if (filterAgentId !== "__all__") {
      list = list.filter((c) => (c.assigned_agent_id || "__none__") === filterAgentId);
    }
    const ts = (c: Conversation) => c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
    const nm = (c: Conversation) => (c.contact?.full_name || c.contact?.whatsapp_number || "").toLowerCase();
    list = [...list].sort((a, b) => {
      switch (sortBy) {
        case "oldest": return ts(a) - ts(b);
        case "unread": return (b.unread_count || 0) - (a.unread_count || 0) || ts(b) - ts(a);
        case "name_asc": return nm(a).localeCompare(nm(b));
        case "name_desc": return nm(b).localeCompare(nm(a));
        default: return ts(b) - ts(a);
      }
    });
    return list;
  }, [conversations, search, filterUnread, filterUnassigned, filterStageId, filterAgentId, sortBy]);

  // SLA badge color based on minutes since last inbound when unread
  function slaTone(c: Conversation): "ok" | "warn" | "danger" | null {
    if (!c.unread_count) return null;
    const ts = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
    if (!ts) return null;
    const mins = (Date.now() - ts) / 60000;
    if (mins < 5) return "ok";
    if (mins < 10) return "warn";
    return "danger";
  }

  const active = conversations.find((c) => c.id === activeId);
  const activeProductName = active?.contact?.interested_product_id
    ? products.find((p) => p.id === active.contact?.interested_product_id)?.name : null;

  async function sendMessage(payload?: string) {
    const content = (payload ?? text).trim();
    if (!content || !activeId) return;
    setSending(true);
    const textBackup = content;
    setText("");

    const tempId = "tmp-" + crypto.randomUUID();
    const optimistic: Message = {
      id: tempId, conversation_id: activeId,
      direction: "OUTBOUND", content, sent_at: new Date().toISOString(),
      sent_by_id: user?.id || null, status: "SENDING",
      type: mode === "note" ? "INTERNAL_NOTE" : "TEXT",
      media_url: null,
    };
    setMessages((prev) => [...prev, optimistic]);

    if (mode === "note") {
      const { data: inserted, error } = await supabase.from("messages").insert({
        conversation_id: activeId,
        direction: "OUTBOUND",
        type: "INTERNAL_NOTE",
        content,
        sent_by_id: user?.id || null,
        status: "SENT",
      } as any).select().single();
      setSending(false);
      if (error) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        toast.error(error.message); setText(textBackup); return;
      }
      setMessages((prev) => prev.map((m) => m.id === tempId ? (inserted as any) : m));
      toast.success("Catatan internal disimpan");
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/twilio-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ conversation_id: activeId, content }),
    });
    const json = await res.json();
    setSending(false);
    if (!res.ok || !json.ok) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      toast.error(json.error || "Gagal kirim"); setText(textBackup); return;
    }
    if (json.message) {
      setMessages((prev) => prev.map((m) => m.id === tempId ? (json.message as Message) : m));
    }
    if (user) {
      await supabase.from("activity_logs").insert({
        user_id: user.id, action: "reply_message",
        entity_type: "conversation", entity_id: activeId,
        metadata: {
          contact_name: active?.contact?.full_name, whatsapp: active?.contact?.whatsapp_number,
          length: content.length,
        },
      } as any);
    }
  }

  async function markUnread(convId: string) {
    const current = conversations.find((c) => c.id === convId);
    const next = (current?.unread_count || 0) > 0 ? 0 : 1;
    setConversations((prev) => prev.map((c) => c.id === convId ? { ...c, unread_count: next } : c));
    const { error } = await supabase.from("conversations").update({ unread_count: next }).eq("id", convId);
    if (error) { toast.error(error.message); loadConversations(); return; }
    toast.success(next > 0 ? "Ditandai belum dibaca" : "Ditandai sudah dibaca");
  }

  function startLongPress(convId: string) {
    longPressFired.current = false;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      if (navigator.vibrate) navigator.vibrate(40);
      markUnread(convId);
    }, 550);
  }
  function cancelLongPress() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }


  async function logAction(action: string, metadata: Record<string, any> = {}) {
    if (!user) return;
    await supabase.from("activity_logs").insert({
      user_id: user.id, action,
      entity_type: "conversation", entity_id: activeId,
      metadata,
    } as any);
  }

  async function assignAgent(agentId: string | null) {
    if (!activeId) return;
    const prev = active?.assigned_agent_id || null;

    // First Response: pakai flow invitation, bukan langsung assign
    if (isFirstResponse && agentId && agentId !== user?.id) {
      // Cegah invitation duplikat pending
      const { data: existing } = await supabase.from("assignment_invitations")
        .select("id").eq("conversation_id", activeId).eq("status", "pending").maybeSingle();
      if (existing) {
        toast.error("Sudah ada invitation pending untuk chat ini. Batalkan dulu di /invitations.");
        return;
      }
      const { data: inv, error } = await supabase.from("assignment_invitations").insert({
        conversation_id: activeId,
        contact_id: active!.contact_id,
        from_user_id: user!.id,
        to_user_id: agentId,
        status: "pending",
        previous_stage_id: active!.contact?.stage_id || null,
      } as any).select().single();
      if (error) { toast.error(error.message); return; }
      await logAction("send_invitation", {
        contact_name: active?.contact?.full_name, whatsapp: active?.contact?.whatsapp_number,
        to_agent: agentId, to_name: agentName(agentId),
        invitation_id: inv?.id,
      });
      // Kirim notifikasi WA ke agent yang diundang — await agar status pengiriman
      // bisa dipertegas ke pengirim (kalau gagal, invitation tetap ada di /invitations).
      try {
        const { data: notifRes, error: notifErr } = await supabase.functions.invoke("notify-agent-assign", {
          body: { conversation_id: activeId, agent_id: agentId, invitation_id: inv?.id, mode: "invitation" },
        });
        if (notifErr) throw notifErr;
        if (notifRes?.ok) {
          toast.success(`Invitation dikirim ke ${agentName(agentId)} + notifikasi WhatsApp terkirim.`);
        } else {
          toast.warning(`Invitation dibuat, tapi WhatsApp tidak terkirim (${notifRes?.skipped || "cek nomor / Twilio"}).`);
        }
      } catch (e: any) {
        toast.warning(`Invitation dibuat, tapi notifikasi WA gagal: ${e?.message || e}`);
      }
      return;
    }

    const { error } = await supabase.from("conversations").update({ assigned_agent_id: agentId }).eq("id", activeId);
    if (error) return toast.error(error.message);
    // Sinkron contact.assigned_agent_id supaya RLS FR ikut lepas/ambil balik lead
    if (active?.contact_id) {
      await supabase.from("contacts").update({ assigned_agent_id: agentId }).eq("id", active.contact_id);
    }
    await logAction("assign_agent", {
      contact_name: active?.contact?.full_name, whatsapp: active?.contact?.whatsapp_number,
      from_agent: prev, to_agent: agentId,
      from_name: agentName(prev), to_name: agentName(agentId),
    });
    toast.success(agentId ? `Ditugaskan ke ${agentName(agentId)}` : "Penugasan dihapus");
    // Fire WhatsApp notification to the newly assigned agent (skip self & unassign)
    if (agentId && agentId !== user?.id) {
      supabase.functions.invoke("notify-agent-assign", {
        body: { conversation_id: activeId, agent_id: agentId },
      }).then((r: any) => {
        if (r?.data?.ok === false && r?.data?.skipped) {
          toast.message(`Notif WA dilewati: ${r.data.skipped}`);
        }
      }).catch(() => {});
    }
    loadConversations();
  }

  async function changeStage(stageId: string) {
    if (!active?.contact_id) return;
    const prevStageId = active.contact?.stage_id || null;
    const { error } = await supabase.from("contacts").update({ stage_id: stageId }).eq("id", active.contact_id);
    if (error) return toast.error(error.message);
    await logAction("change_stage", {
      contact_id: active.contact_id,
      contact_name: active.contact?.full_name, whatsapp: active.contact?.whatsapp_number,
      from_stage_id: prevStageId,
      to_stage_id: stageId,
      from_stage: stages.find((s) => s.id === prevStageId)?.name || null,
      to_stage: stages.find((s) => s.id === stageId)?.name || null,
    });
    toast.success("Stage diperbarui");
    loadConversations();
  }

  async function changeProduct(productId: string | null) {
    if (!active?.contact_id) return;
    const prev = active.contact?.interested_product_id || null;
    const { error } = await supabase.from("contacts").update({ interested_product_id: productId }).eq("id", active.contact_id);
    if (error) return toast.error(error.message);
    await logAction("change_product", {
      contact_id: active.contact_id,
      contact_name: active.contact?.full_name, whatsapp: active.contact?.whatsapp_number,
      from_product_id: prev, to_product_id: productId,
      from_product: products.find((p) => p.id === prev)?.name || null,
      to_product: products.find((p) => p.id === productId)?.name || null,
    });
    toast.success("Produk diperbarui");
    loadConversations();
  }

  async function saveName() {
    if (!active?.contact_id) { setEditingName(false); return; }
    const newName = nameDraft.trim();
    const oldName = active.contact?.full_name || "";
    if (!newName || newName === oldName) { setEditingName(false); return; }
    const { error } = await supabase.from("contacts").update({ full_name: newName }).eq("id", active.contact_id);
    if (error) { toast.error(error.message); return; }
    await logAction("rename_contact", {
      contact_id: active.contact_id,
      whatsapp: active.contact?.whatsapp_number,
      from_name: oldName, to_name: newName,
      contact_name: newName,
    });
    toast.success("Nama lead diperbarui");
    setEditingName(false);
    loadConversations();
  }

  async function saveDomicile(next: string) {
    if (!active?.contact_id) return;
    const newVal = next.trim() || null;
    const oldVal = active.contact?.domicile || null;
    if (newVal === oldVal) return;
    const { error } = await supabase.from("contacts").update({ domicile: newVal }).eq("id", active.contact_id);
    if (error) { toast.error(error.message); return; }
    await logAction("update_domicile", {
      contact_id: active.contact_id,
      whatsapp: active.contact?.whatsapp_number,
      contact_name: active.contact?.full_name,
      from_domicile: oldVal, to_domicile: newVal,
    });
    toast.success("Domisili diperbarui");
    loadConversations();
  }

  async function deleteConversation() {
    if (!active) return;
    // Delete conversation (cascade removes messages). Reset chatbot_state so the next inbound restarts the bot — but keep the lead (contact) so name/phone/keluhan get UPDATED in place on the next round.
    const { error: delErr } = await supabase.from("conversations").delete().eq("id", active.id);
    if (delErr) return toast.error(delErr.message);
    await supabase.from("contacts").update({ chatbot_state: null }).eq("id", active.contact_id);
    await logAction("delete_chat", {
      contact_name: active.contact?.full_name, whatsapp: active.contact?.whatsapp_number,
      message_count: messages.length,
    });
    toast.success("Percakapan dihapus. Bot akan menanyakan ulang saat pesan berikutnya masuk.");
    setActiveId(null);
    loadConversations();
  }

  function agentName(id: string | null) {
    if (!id) return "Sistem";
    const p = profiles[id];
    return p?.full_name || p?.email?.split("@")[0] || "Agent";
  }

  function applyQuickReply(content: string) {
    const myName = agentName(user?.id || null);
    const filled = content.replace(/\{agent\}/g, myName);
    setText(filled);
    setMode("reply");
  }

  return (
    <div className="max-w-7xl mx-auto px-3 md:px-6 h-[calc(100vh-7rem)]">
      <div className="h-full flex bg-card glow-soft rounded-2xl overflow-hidden border">
        {/* List */}
        <div className={cn("w-full md:w-[340px] border-r flex flex-col", activeId && "hidden md:flex")}>
          <div className="p-3 border-b">
            <div className="text-sm font-semibold mb-2">{mineOnly ? "Inbox Saya" : "Semua Inbox"}</div>
            <div className="relative">
              <Search className="size-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari kontak..." className="pl-8" />
            </div>
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                <SelectTrigger className="h-7 text-[11px] flex-1 min-w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Terbaru</SelectItem>
                  <SelectItem value="oldest">Terlama</SelectItem>
                  <SelectItem value="unread">Belum dibaca</SelectItem>
                  <SelectItem value="name_asc">Nama A-Z</SelectItem>
                  <SelectItem value="name_desc">Nama Z-A</SelectItem>
                </SelectContent>
              </Select>
              <button onClick={() => setFilterUnread((v) => !v)}
                className={cn("text-[10px] px-2 py-1 rounded-md border transition-colors",
                  filterUnread ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent")}>
                Unread
              </button>
              <button onClick={() => setFilterUnassigned((v) => !v)}
                className={cn("text-[10px] px-2 py-1 rounded-md border transition-colors",
                  filterUnassigned ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent")}>
                Belum assign
              </button>
            </div>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <Select value={filterStageId} onValueChange={setFilterStageId}>
                <SelectTrigger className="h-7 text-[11px] flex-1 min-w-[120px]"><SelectValue placeholder="Stage" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Semua stage</SelectItem>
                  <SelectItem value="__none__">Tanpa stage</SelectItem>
                  {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterAgentId} onValueChange={setFilterAgentId}>
                <SelectTrigger className="h-7 text-[11px] flex-1 min-w-[120px]"><SelectValue placeholder="Agent" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Semua agent</SelectItem>
                  <SelectItem value="__none__">Belum ditugaskan</SelectItem>
                  {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.full_name || a.email}</SelectItem>)}
                </SelectContent>
              </Select>
              {(filterStageId !== "__all__" || filterAgentId !== "__all__") && (
                <button onClick={() => { setFilterStageId("__all__"); setFilterAgentId("__all__"); }}
                  className="text-[10px] px-2 py-1 rounded-md border hover:bg-accent">Reset</button>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
              <span className="inline-block size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live · {filtered.length}/{conversations.length} percakapan
              {isFirstResponse && <span className="ml-2 px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-300">FR Mode</span>}
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {filtered.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Belum ada percakapan{mineOnly ? " yang ditugaskan kepada Anda." : "."}
              </div>
            )}
            {filtered.map((c) => {
              const stage = stages.find((s) => s.id === c.contact?.stage_id);
              const sla = slaTone(c);
              const slaCls = sla === "ok" ? "border-l-emerald-500" : sla === "warn" ? "border-l-amber-500" : sla === "danger" ? "border-l-rose-500" : "border-l-transparent";
              return (
                <button key={c.id}
                  onClick={() => { if (longPressFired.current) { longPressFired.current = false; return; } setActiveId(c.id); }}
                  onPointerDown={() => startLongPress(c.id)}
                  onPointerUp={cancelLongPress}
                  onPointerLeave={cancelLongPress}
                  onPointerCancel={cancelLongPress}
                  onContextMenu={(e) => { e.preventDefault(); markUnread(c.id); }}
                  className={cn("w-full text-left px-4 py-3 border-b border-l-4 hover:bg-accent/60 flex flex-col gap-1 transition-colors select-none touch-none",
                    slaCls,
                    activeId === c.id && "bg-accent")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">
                      {c.contact?.full_name || "Tanpa nama"}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span
                        role="button"
                        title={c.unread_count > 0 ? "Tandai sudah dibaca" : "Tandai belum dibaca (atau tahan)"}
                        onClick={(e) => { e.stopPropagation(); markUnread(c.id); }}
                        className="opacity-60 hover:opacity-100 p-1 rounded hover:bg-background/60 cursor-pointer">
                        <MailOpen className="size-3" />
                      </span>
                      {c.unread_count > 0 && (
                        <span className="text-[10px] bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 glow-primary">
                          {c.unread_count}
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="text-[11px] text-muted-foreground">{c.contact?.whatsapp_number}</div>
                  <div className="text-xs text-muted-foreground truncate">{c.last_message_preview || "—"}</div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {stage && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={{ backgroundColor: (stage.color || "#888") + "20", color: stage.color || "inherit" }}>
                        {stage.name}
                      </span>
                    )}
                    {c.assigned_agent_id ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-300 flex items-center gap-1">
                        <UserIcon className="size-2.5" /> {agentName(c.assigned_agent_id)}
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
                        Belum ditugaskan
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {c.last_message_at && formatDistanceToNow(new Date(c.last_message_at), { addSuffix: true, locale: idLocale })}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Chat panel */}
        <div className={cn("flex-1 flex flex-col min-w-0", !activeId && "hidden md:flex")}>
          {!active ? (
            <div className="flex-1 grid place-items-center text-muted-foreground text-sm">
              Pilih percakapan untuk mulai chat.
            </div>
          ) : (
            <>
              <header className="px-4 py-3 border-b bg-card/80 backdrop-blur">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <button className="md:hidden text-xs text-primary mb-1" onClick={() => setActiveId(null)}>← Kembali</button>
                    {editingName ? (
                      <input
                        autoFocus
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onBlur={saveName}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); saveName(); }
                          else if (e.key === "Escape") { setEditingName(false); }
                        }}
                        className="font-semibold text-base bg-transparent border-b border-primary focus:outline-none w-full max-w-[260px]"
                        placeholder="Nama lead"
                      />
                    ) : (
                      <button
                        type="button"
                        className="font-semibold text-base truncate text-left hover:text-primary transition-colors"
                        title="Klik untuk ubah nama lead"
                        onClick={() => { setNameDraft(active.contact?.full_name || ""); setEditingName(true); }}
                      >
                        {active.contact?.full_name || "Tanpa nama"}
                      </button>
                    )}
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
                      <span>{active.contact?.whatsapp_number}</span>
                      {activeProductName && <span>· {activeProductName}</span>}
                    </div>
                    {/* Keluhan + extras: desktop only */}
                    <div className="hidden md:block">
                      {active.contact?.domicile && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">{active.contact.domicile}</div>
                      )}
                      {active.contact?.chief_complaint && (
                        <div className="text-[11px] text-muted-foreground mt-1 italic line-clamp-1">
                          Keluhan: {active.contact.chief_complaint}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Desktop quick actions */}
                  <div className="hidden md:flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <Tag className="size-3.5 text-muted-foreground" />
                      <Select value={active.contact?.stage_id || ""} onValueChange={changeStage}>
                        <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="Stage" /></SelectTrigger>
                        <SelectContent>
                          {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Package className="size-3.5 text-muted-foreground" />
                      <Select value={active.contact?.interested_product_id || "none"}
                        onValueChange={(v) => changeProduct(v === "none" ? null : v)}>
                        <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="Produk" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Tanpa produk</SelectItem>
                          {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <UserIcon className="size-3.5 text-muted-foreground" />
                      <Select value={active.assigned_agent_id || "unassigned"}
                        onValueChange={(v) => assignAgent(v === "unassigned" ? null : v)}>
                        <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue placeholder="Agent" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Belum ditugaskan</SelectItem>
                          {agents.map((a) => (
                            <SelectItem key={a.id} value={a.id}>{a.full_name || a.email?.split("@")[0]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {user && active.assigned_agent_id !== user.id && (
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => assignAgent(user.id)}>
                        Ambil chat
                      </Button>
                    )}
                    <DeleteChatButton onConfirm={deleteConversation} variant="desktop" />
                  </div>

                  {/* Mobile actions menu */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button size="icon" variant="ghost" className="md:hidden h-9 w-9 shrink-0">
                        <MoreVertical className="size-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-3 space-y-3" align="end"
                      onOpenAutoFocus={() => { setNameDraft(active.contact?.full_name || ""); setDomicileDraft(active.contact?.domicile || ""); }}>
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                          <UserIcon className="size-3" /> Nama lead
                        </div>
                        <Input
                          value={nameDraft}
                          onChange={(e) => setNameDraft(e.target.value)}
                          onBlur={saveName}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                          placeholder="Nama lengkap lead"
                          className="h-9 text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                          <UserIcon className="size-3" /> Domisili
                        </div>
                        <Input
                          value={domicileDraft}
                          onChange={(e) => setDomicileDraft(e.target.value)}
                          onBlur={() => saveDomicile(domicileDraft)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                          placeholder="cth: Jakarta Selatan"
                          className="h-9 text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                          <Tag className="size-3" /> Stage
                        </div>
                        <Select value={active.contact?.stage_id || ""} onValueChange={changeStage}>
                          <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Pilih stage" /></SelectTrigger>
                          <SelectContent>
                            {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                          <Package className="size-3" /> Produk
                        </div>
                        <Select value={active.contact?.interested_product_id || "none"}
                          onValueChange={(v) => changeProduct(v === "none" ? null : v)}>
                          <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Pilih produk" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Tanpa produk</SelectItem>
                            {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                          <UserIcon className="size-3" /> Tugaskan agent
                        </div>
                        <Select value={active.assigned_agent_id || "unassigned"}
                          onValueChange={(v) => assignAgent(v === "unassigned" ? null : v)}>
                          <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">Belum ditugaskan</SelectItem>
                            {agents.map((a) => (
                              <SelectItem key={a.id} value={a.id}>{a.full_name || a.email?.split("@")[0]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {user && active.assigned_agent_id !== user.id && (
                        <Button size="sm" className="w-full h-9 text-xs" onClick={() => assignAgent(user.id)}>
                          Ambil chat ini
                        </Button>
                      )}
                      <DeleteChatButton onConfirm={deleteConversation} variant="mobile" />
                      {active.contact?.chief_complaint && (
                        <div className="text-[11px] text-muted-foreground pt-2 border-t italic">
                          Keluhan: {active.contact.chief_complaint}
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
                </div>
              </header>

              <div ref={scrollRef} className="flex-1 overflow-auto p-4 space-y-3 bg-muted/30">
                {messages.map((m) => {
                  if (m.type === "INTERNAL_NOTE") {
                    return (
                      <div key={m.id} className="flex justify-center">
                        <div className="max-w-[85%] rounded-xl border border-amber-400/50 bg-amber-100/70 dark:bg-amber-500/10 px-3 py-2 text-xs shadow-sm">
                          <div className="flex items-center gap-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-300 mb-1">
                            <StickyNote className="size-3" />
                            Catatan Internal · {agentName(m.sent_by_id)}
                          </div>
                          <div className="whitespace-pre-wrap break-words text-amber-900 dark:text-amber-100">{m.content}</div>
                          <div className="text-[10px] opacity-60 mt-1 text-right">
                            {new Date(m.sent_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>
                      </div>
                    );
                  }
                  const out = m.direction === "OUTBOUND";
                  // Attribute outbound to the message sender; if missing, fall back to conv's assigned/last replier
                  const fallbackAgent = active.assigned_agent_id || active.last_replied_by_id || null;
                  const effectiveAgentId = m.sent_by_id || fallbackAgent;
                  const senderLabel = out
                    ? (effectiveAgentId ? agentName(effectiveAgentId) : "Sistem")
                    : (active.contact?.full_name || "Pelanggan");
                  return (
                    <div key={m.id} className={cn("flex flex-col gap-0.5", out ? "items-end" : "items-start")}>
                      <span className="text-[10px] px-1 text-muted-foreground">
                        {senderLabel}
                      </span>
                      <div className={cn("max-w-[75%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words shadow-sm",
                        out ? "bg-chat-out text-chat-out-foreground rounded-br-sm"
                            : "bg-chat-in text-chat-in-foreground border rounded-bl-sm")}>
                        {m.media_url && m.type === "IMAGE" && (
                          <a href={m.media_url} target="_blank" rel="noreferrer" className="block mb-1">
                            <img src={m.media_url} alt="attachment" className="max-h-64 rounded-lg object-cover" />
                          </a>
                        )}
                        {m.media_url && m.type === "AUDIO" && (
                          <audio src={m.media_url} controls className="max-w-full mb-1" />
                        )}
                        {m.media_url && m.type === "DOCUMENT" && (
                          <a href={m.media_url} target="_blank" rel="noreferrer"
                            className="flex items-center gap-2 mb-1 px-2 py-1.5 rounded-lg bg-background/40 border border-white/20 hover:bg-background/60 text-xs">
                            <FileText className="size-4 shrink-0" />
                            <span className="truncate">{m.content || "Dokumen"}</span>
                          </a>
                        )}
                        {(!m.media_url || m.type === "TEXT") && m.content}
                        {m.media_url && m.type !== "TEXT" && m.content && m.content !== "(attachment)" && (
                          <div className="mt-1">{m.content}</div>
                        )}
                        <div className="text-[10px] opacity-60 mt-1 text-right">
                          {new Date(m.sent_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {messages.length === 0 && <p className="text-center text-xs text-muted-foreground">Belum ada pesan.</p>}
              </div>

              <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} className="border-t p-3 bg-card space-y-2">
                <div className="flex flex-wrap gap-1.5 items-center">
                  <div className="inline-flex rounded-full border bg-background p-0.5 text-[11px]">
                    <button type="button" onClick={() => setMode("reply")}
                      className={cn("px-2.5 py-1 rounded-full flex items-center gap-1 transition-colors",
                        mode === "reply" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
                      <MessageSquare className="size-3" /> Balas WA
                    </button>
                    <button type="button" onClick={() => setMode("note")}
                      className={cn("px-2.5 py-1 rounded-full flex items-center gap-1 transition-colors",
                        mode === "note" ? "bg-amber-500 text-white" : "text-muted-foreground")}>
                      <StickyNote className="size-3" /> Catatan
                    </button>
                  </div>
                  {mode === "reply" && (
                    <>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1">
                            <Zap className="size-3" /> Quick Replies
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-1" align="start">
                          <div className="max-h-72 overflow-auto">
                            {quickReplies.length === 0 && (
                              <div className="p-3 text-xs text-muted-foreground">Belum ada template. Tambah di Settings.</div>
                            )}
                            {quickReplies.map((q) => (
                              <button key={q.id} type="button" onClick={() => applyQuickReply(q.content)}
                                className="w-full text-left px-3 py-2 rounded-md hover:bg-accent text-xs">
                                <div className="font-medium">{q.name}</div>
                                <div className="text-muted-foreground line-clamp-2">{q.content}</div>
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <div className="hidden sm:flex flex-wrap gap-1.5">
                        {quickReplies.slice(0, 3).map((q) => (
                          <button key={q.id} type="button" onClick={() => applyQuickReply(q.content)}
                            className="text-[11px] px-2 py-1 rounded-full border bg-background hover:bg-accent transition-colors flex items-center gap-1">
                            <FileText className="size-3" /> {q.name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input value={text} onChange={(e) => setText(e.target.value)}
                    placeholder={mode === "note"
                      ? "Catatan internal — hanya dilihat agent..."
                      : `Balas sebagai ${agentName(user?.id || null)}...`}
                    disabled={sending}
                    className={mode === "note" ? "bg-amber-50 dark:bg-amber-500/10 border-amber-300" : ""}
                    autoFocus />
                  <Button type="submit" disabled={sending || !text.trim()}
                    className={mode === "note" ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}>

                    {sending ? <Loader2 className="size-4 animate-spin" /> :
                      mode === "note" ? <StickyNote className="size-4" /> : <Send className="size-4" />}
                  </Button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DeleteChatButton({ onConfirm, variant }: { onConfirm: () => void; variant: "desktop" | "mobile" }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {variant === "desktop" ? (
          <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive hover:bg-destructive/10 gap-1">
            <Trash2 className="size-3.5" /> Hapus
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="w-full h-9 text-xs text-destructive border-destructive/40 gap-1.5">
            <Trash2 className="size-3.5" /> Hapus percakapan
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus percakapan?</AlertDialogTitle>
          <AlertDialogDescription>
            Semua pesan dalam percakapan ini akan dihapus permanen. Data lead (nama, nomor, stage) tetap tersimpan di Leads.
            Saat user mengirim pesan baru, bot akan menanyakan ulang produk, domisili, dan keluhan — lalu mengupdate data lead.
            Tindakan ini akan dicatat di Log Aktivitas.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Ya, hapus
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
