import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
// tabs replaced with custom pill nav
import { toast } from "sonner";
import { CheckCircle2, XCircle, Loader2, Copy, ExternalLink, MessageCircle, Send, Power } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { WorkflowBuilderTab } from "@/components/workflow-builder";
import { FRWeeklySchedule } from "@/components/fr-weekly-schedule";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings — Husada CRM" }] }),
  component: SettingsPage,
});

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

function SettingsPage() {
  const [tab, setTab] = useState("gateway");
  const tabs = [
    { v: "gateway", label: "WhatsApp Gateway" },
    { v: "stages", label: "Stages Pipeline" },
    { v: "flow", label: "Bot Workflow" },
    { v: "categories", label: "Kategori Pertanyaan" },
    { v: "quick", label: "Quick Replies" },
    { v: "products", label: "Produk" },
    { v: "team", label: "Tim Agent" },
    { v: "shifts", label: "Jadwal Mingguan FR" },
  ];
  return (
    <div className="p-3 md:p-6 max-w-6xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Konfigurasi sistem, integrasi WhatsApp, tim, dan template balasan cepat.</p>
      </header>

      {/* Segmented pill nav — wraps cleanly on mobile */}
      <div className="flex flex-wrap gap-1.5 p-1.5 rounded-2xl bg-card border glow-soft">
        {tabs.map((t) => (
          <button key={t.v} onClick={() => setTab(t.v)}
            className={`flex-1 min-w-[120px] px-3 py-2 rounded-xl text-xs md:text-sm font-medium transition-all ${
              tab === t.v ? "bg-primary text-primary-foreground glow-primary" : "text-foreground/70 hover:bg-accent"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      <div>
        {tab === "gateway" && <FonnteTab />}
        {tab === "stages" && <WorkflowTab />}
        {tab === "flow" && <WorkflowBuilderTab />}
        {tab === "categories" && <CategoriesTab />}
        {tab === "quick" && <QuickRepliesTab />}
        {tab === "products" && <ProductsTab />}
        {tab === "team" && <TeamTab />}
        {tab === "shifts" && <FRWeeklySchedule />}

        
      </div>

    </div>
  );
}

function CategoriesTab() {
  const DEFAULTS = ["Layanan", "Tindakan", "Administratif", "Rawat Jalan", "Rawat Inap", "Laboratorium", "Medical Check Up", "Asuransi", "BPJS", "Lainnya"];
  const [items, setItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("system_settings").select("value").eq("key", "question_categories").maybeSingle();
      let parsed: string[] = [];
      if (data?.value) {
        try { parsed = JSON.parse(data.value); } catch { parsed = []; }
      }
      setItems(Array.isArray(parsed) && parsed.length ? parsed : DEFAULTS);
      setLoading(false);
    })();
  }, []);

  async function save(next: string[]) {
    setSaving(true);
    const clean = next.map((s) => s.trim()).filter(Boolean);
    const { error } = await supabase.from("system_settings").upsert({ key: "question_categories", value: JSON.stringify(clean) }, { onConflict: "key" });
    setSaving(false);
    if (error) toast.error(error.message); else toast.success("Kategori disimpan");
  }

  function update(i: number, v: string) { setItems(items.map((x, idx) => (idx === i ? v : x))); }
  function remove(i: number) { const next = items.filter((_, idx) => idx !== i); setItems(next); save(next); }
  function add() { setItems([...items, "Kategori Baru"]); }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items]; [next[i], next[j]] = [next[j], next[i]];
    setItems(next); save(next);
  }
  function resetDefaults() { setItems(DEFAULTS); save(DEFAULTS); }

  if (loading) return <div className="mt-4 text-sm text-muted-foreground">Memuat…</div>;

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Kategori Pertanyaan</CardTitle>
          <CardDescription>
            Daftar kategori yang ditampilkan ke pelanggan saat menanyakan "Pilih kategori pertanyaan Anda" (1, 2, 3, …). Bisa ditambah, diubah, dihapus, dan diurutkan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-7 text-center text-xs font-mono text-muted-foreground">{i + 1}.</span>
              <Input value={it} onChange={(e) => update(i, e.target.value)} onBlur={() => save(items)} />
              <Button type="button" variant="outline" size="sm" onClick={() => move(i, -1)} disabled={i === 0}>↑</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => move(i, 1)} disabled={i === items.length - 1}>↓</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)} className="text-rose-600">Hapus</Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" onClick={add}>Tambah Kategori</Button>
            <Button type="button" variant="outline" onClick={() => save(items)} disabled={saving}>
              {saving ? "Menyimpan…" : "Simpan Semua"}
            </Button>
            <Button type="button" variant="ghost" onClick={resetDefaults} className="ml-auto">Reset ke default</Button>
          </div>
          <p className="text-[11px] text-muted-foreground pt-2">
            Tip: hubungkan daftar ini di tab <strong>Bot Workflow</strong> sebagai opsi pilihan kategori. Perubahan disimpan otomatis saat berpindah dari kolom input.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}


function QuickRepliesTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");

  async function load() {
    const { data } = await supabase.from("templates").select("*").eq("is_quick_reply", true).order("sort_order");
    setRows(data || []);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!name.trim() || !content.trim()) return toast.error("Nama & isi wajib diisi");
    const { error } = await supabase.from("templates").insert({
      name, content, is_quick_reply: true, sort_order: (rows[rows.length - 1]?.sort_order || 0) + 1, category: "custom",
    });
    if (error) toast.error(error.message);
    else { setName(""); setContent(""); load(); toast.success("Quick reply ditambahkan"); }
  }
  async function update(id: string, patch: any) {
    const { error } = await supabase.from("templates").update(patch).eq("id", id);
    if (error) toast.error(error.message); else load();
  }
  async function remove(id: string) {
    const { error } = await supabase.from("templates").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Dihapus"); load(); }
  }

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Tambah Quick Reply</CardTitle>
          <CardDescription>Gunakan placeholder <code className="text-xs bg-muted px-1 rounded">{"{agent}"}</code> untuk otomatis isi nama agent yang membalas.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Nama template (cth: Opening)" value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea rows={3} placeholder="Isi pesan..." value={content} onChange={(e) => setContent(e.target.value)} />
          <Button onClick={add}>Tambah</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Daftar Quick Replies ({rows.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="border rounded-md p-3 space-y-2">
              <Input value={r.name} onChange={(e) => setRows(rows.map(x => x.id === r.id ? { ...x, name: e.target.value } : x))}
                onBlur={() => update(r.id, { name: r.name })} className="font-medium" />
              <Textarea rows={2} value={r.content}
                onChange={(e) => setRows(rows.map(x => x.id === r.id ? { ...x, content: e.target.value } : x))}
                onBlur={() => update(r.id, { content: r.content })} />
              <div className="flex justify-end">
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(r.id)}>Hapus</Button>
              </div>
            </div>
          ))}
          {!rows.length && <p className="text-sm text-muted-foreground">Belum ada quick reply.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function FonnteTab() {
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [whatsappFrom, setWhatsappFrom] = useState("");
  const [messagingServiceSid, setMessagingServiceSid] = useState("");
  const [apiKeySid, setApiKeySid] = useState("");
  const [apiKeySecret, setApiKeySecret] = useState("");
  const [contentSidAssign, setContentSidAssign] = useState("");
  const [contentSidInvite, setContentSidInvite] = useState("");
  const [contentSidFollowUp, setContentSidFollowUp] = useState("");
  const [savingTemplates, setSavingTemplates] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testNumber, setTestNumber] = useState("");
  const [testMsg, setTestMsg] = useState("Test pesan dari Husada CRM ✅");
  const [sending, setSending] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("system_settings").select("key,value")
      .in("key", [
        "twilio_account_sid", "twilio_auth_token", "twilio_whatsapp_from",
        "twilio_messaging_service_sid", "twilio_api_key_sid", "twilio_api_key_secret",
        "twilio_content_sid_agent_assignment", "twilio_content_sid_lead_invitation",
        "twilio_content_sid_lead_follow_up",
      ]);
    data?.forEach((r) => {
      if (r.key === "twilio_account_sid") setAccountSid(r.value || "");
      if (r.key === "twilio_auth_token") setAuthToken(r.value || "");
      if (r.key === "twilio_whatsapp_from") setWhatsappFrom(r.value || "");
      if (r.key === "twilio_messaging_service_sid") setMessagingServiceSid(r.value || "");
      if (r.key === "twilio_api_key_sid") setApiKeySid(r.value || "");
      if (r.key === "twilio_api_key_secret") setApiKeySecret(r.value || "");
      if (r.key === "twilio_content_sid_agent_assignment") setContentSidAssign(r.value || "");
      if (r.key === "twilio_content_sid_lead_invitation") setContentSidInvite(r.value || "");
      if (r.key === "twilio_content_sid_lead_follow_up") setContentSidFollowUp(r.value || "");
    });
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const connected = !!(accountSid && (authToken || (apiKeySid && apiKeySecret)) && (whatsappFrom || messagingServiceSid));

  async function save() {
    if (!accountSid) return toast.error("Account SID wajib diisi");
    if (!authToken && !(apiKeySid && apiKeySecret)) return toast.error("Isi Auth Token, atau pasangan API Key SID + Secret");
    if (!whatsappFrom && !messagingServiceSid) return toast.error("Isi WhatsApp From atau Messaging Service SID");
    setSaving(true);
    setTestResult(null);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/twilio-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({
        account_sid: accountSid,
        auth_token: authToken,
        whatsapp_from: whatsappFrom,
        messaging_service_sid: messagingServiceSid,
        api_key_sid: apiKeySid,
        api_key_secret: apiKeySecret,
      }),
    });
    const j = await res.json();
    setSaving(false);
    setTestResult(j);
    if (!res.ok) { toast.error(j.error || "Gagal menyimpan"); return; }
    if (j.validate_ok) toast.success("Tersimpan · Twilio terverifikasi");
    else toast.warning("Tersimpan, tapi kredensial belum tervalidasi — cek SID/Token/API Key");
  }

  async function testConnection() {
    if (!accountSid) return toast.error("Masukkan Account SID");
    if (!authToken && !(apiKeySid && apiKeySecret)) return toast.error("Isi Auth Token atau API Key");
    setTesting(true);
    setTestResult(null);
    const res = await fetch(`${SUPABASE_URL}/functions/v1/twilio-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_sid: accountSid,
        auth_token: authToken,
        api_key_sid: apiKeySid,
        api_key_secret: apiKeySecret,
      }),
    });
    const j = await res.json();
    setTestResult(j);
    setTesting(false);
    if (j.ok) toast.success("Twilio terkoneksi!");
    else toast.error("Koneksi gagal. Cek kredensial.");
  }

  async function disconnect() {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/twilio-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({
        account_sid: "", auth_token: "", whatsapp_from: "",
        messaging_service_sid: "", api_key_sid: "", api_key_secret: "",
      }),
    });
    if (res.ok) {
      setAccountSid(""); setAuthToken(""); setWhatsappFrom("");
      setMessagingServiceSid(""); setApiKeySid(""); setApiKeySecret("");
      setTestResult(null);
      toast.success("Twilio diputuskan");
    } else toast.error("Gagal disconnect");
  }

  async function testSend() {
    if (!testNumber) return toast.error("Masukkan nomor tujuan");
    setSending(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/twilio-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ target: testNumber, content: testMsg, is_test: true }),
    });
    const j = await res.json();
    setSending(false);
    if (j.ok) toast.success("Pesan test terkirim! Cek WhatsApp.");
    else toast.error(j.error || JSON.stringify(j.twilio || j));
  }

  async function saveTemplates() {
    setSavingTemplates(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/twilio-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({
        // send existing credentials so wipe-disconnect doesn't trigger
        account_sid: accountSid, auth_token: authToken, whatsapp_from: whatsappFrom,
        messaging_service_sid: messagingServiceSid, api_key_sid: apiKeySid, api_key_secret: apiKeySecret,
        content_sid_agent_assignment: contentSidAssign.trim(),
        content_sid_lead_invitation: contentSidInvite.trim(),
        content_sid_lead_follow_up: contentSidFollowUp.trim(),
      }),
    });
    const j = await res.json();
    setSavingTemplates(false);
    if (res.ok && j.success) toast.success("Content SID tersimpan");
    else toast.error(j.error || "Gagal menyimpan Content SID");

  const inboundUrl = `${SUPABASE_URL}/functions/v1/twilio-webhook`;
  const statusUrl = `${SUPABASE_URL}/functions/v1/twilio-status`;

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="size-5" /> Twilio WhatsApp Gateway
            {connected && <Badge className="bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">Terhubung</Badge>}
          </CardTitle>
          <CardDescription>
            Semua kredensial Twilio Programmable Messaging disimpan di sini dan bisa diganti kapan saja. Ambil di{" "}
            <a href="https://console.twilio.com/" target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">
              console.twilio.com <ExternalLink className="size-3" />
            </a>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && <div className="text-sm text-muted-foreground">Memuat kredensial…</div>}

          {connected && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-sm">
              <CheckCircle2 className="size-4 text-emerald-600" />
              <div className="min-w-0">
                <div className="font-medium text-emerald-700 dark:text-emerald-300">Aktif</div>
                <div className="text-xs text-emerald-700/80 dark:text-emerald-300/80 font-mono truncate">
                  {whatsappFrom || messagingServiceSid} · {accountSid.slice(0, 10)}…
                </div>
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-1.5 md:col-span-2">
              <Label>Account SID <span className="text-destructive">*</span></Label>
              <Input value={accountSid} onChange={(e) => setAccountSid(e.target.value)} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className="font-mono text-xs" />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label>Auth Token</Label>
              <Input type="password" value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder="Twilio Auth Token" className="font-mono text-xs" />
              <p className="text-[11px] text-muted-foreground">Isi salah satu: Auth Token, <em>atau</em> pasangan API Key SID + Secret di bawah (direkomendasikan untuk production).</p>
            </div>

            <div className="space-y-1.5">
              <Label>API Key SID</Label>
              <Input value={apiKeySid} onChange={(e) => setApiKeySid(e.target.value)} placeholder="SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label>API Key Secret</Label>
              <Input type="password" value={apiKeySecret} onChange={(e) => setApiKeySecret(e.target.value)} placeholder="Twilio API Key Secret" className="font-mono text-xs" />
            </div>

            <div className="space-y-1.5">
              <Label>Nomor WhatsApp (From)</Label>
              <Input value={whatsappFrom} onChange={(e) => setWhatsappFrom(e.target.value)} placeholder="+14155238886" className="font-mono text-xs" />
              <p className="text-[11px] text-muted-foreground">Format E.164. Sandbox atau WhatsApp Business Number.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Messaging Service SID (opsional)</Label>
              <Input value={messagingServiceSid} onChange={(e) => setMessagingServiceSid(e.target.value)} placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className="font-mono text-xs" />
              <p className="text-[11px] text-muted-foreground">Jika diisi, akan diprioritaskan daripada nomor "From".</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={save} disabled={saving || loading}>
              {saving && <Loader2 className="size-4 mr-2 animate-spin" />} Simpan Kredensial
            </Button>
            <Button variant="outline" onClick={testConnection} disabled={testing || !accountSid}>
              {testing && <Loader2 className="size-4 mr-2 animate-spin" />} Test Koneksi
            </Button>
            {(accountSid || authToken || whatsappFrom || messagingServiceSid || apiKeySid || apiKeySecret) && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="ml-auto">
                    <Power className="size-4 mr-2" /> Disconnect
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Putuskan koneksi Twilio?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Semua kredensial (SID, Token, API Key, Nomor, Messaging Service) akan dihapus. Pesan WhatsApp tidak akan terkirim/terterima sampai dihubungkan kembali.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction onClick={disconnect}>Ya, disconnect</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>

          {testResult && (
            <div className={`mt-2 p-3 rounded-md text-sm border ${(testResult.ok || testResult.validate_ok) ? "bg-success/10 border-success/30 text-success" : "bg-destructive/10 border-destructive/30 text-destructive"}`}>
              <div className="flex items-center gap-2 font-medium">
                {(testResult.ok || testResult.validate_ok) ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                {(testResult.ok || testResult.validate_ok) ? "Twilio terhubung" : (testResult.twilio_message || testResult.error || "Gagal terhubung")}
              </div>
              <pre className="text-[11px] mt-2 overflow-x-auto opacity-80">{JSON.stringify(testResult.data || testResult.validate || testResult, null, 2)}</pre>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook URL untuk Twilio Console</CardTitle>
          <CardDescription>
            Salin URL ini ke <strong>Twilio Console → Messaging → Senders/Sandbox</strong>. Metode <strong>POST</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Inbound Webhook ("When a message comes in")</Label>
            <div className="flex gap-2">
              <Input readOnly value={inboundUrl} className="font-mono text-xs" />
              <Button variant="outline" onClick={() => { navigator.clipboard.writeText(inboundUrl); toast.success("Disalin"); }}>
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Status Callback URL</Label>
            <div className="flex gap-2">
              <Input readOnly value={statusUrl} className="font-mono text-xs" />
              <Button variant="outline" onClick={() => { navigator.clipboard.writeText(statusUrl); toast.success("Disalin"); }}>
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Send className="size-5" /> Test Kirim Pesan</CardTitle>
          <CardDescription>Verifikasi kirim end-to-end setelah simpan kredensial.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nomor Tujuan (E.164)</Label>
            <Input value={testNumber} onChange={(e) => setTestNumber(e.target.value)} placeholder="+6281234567890" />
          </div>
          <div className="space-y-1.5">
            <Label>Pesan</Label>
            <Textarea rows={3} value={testMsg} onChange={(e) => setTestMsg(e.target.value)} />
          </div>
          <Button onClick={testSend} disabled={sending || !connected}>
            {sending && <Loader2 className="size-4 mr-2 animate-spin" />} Kirim Test
          </Button>
        </CardContent>
      </Card>

      <GatewayLogsCard />
    </div>
  );
}

function GatewayLogsCard() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "error">("all");

  async function load() {
    setLoading(true);
    let q = supabase.from("whatsapp_gateway_logs").select("*").order("created_at", { ascending: false }).limit(100);
    if (filter === "error") q = q.eq("level", "error");
    const { data } = await q;
    setLogs(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [filter]);
  useEffect(() => {
    const ch = supabase.channel("gw-logs")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "whatsapp_gateway_logs" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [filter]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">Log Gateway WhatsApp</CardTitle>
        <CardDescription>Riwayat kirim, status pengiriman, dan error terbaru dari Twilio.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-2">
          <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>Semua</Button>
          <Button size="sm" variant={filter === "error" ? "default" : "outline"} onClick={() => setFilter("error")}>Error</Button>
          <Button size="sm" variant="ghost" onClick={load} className="ml-auto">Refresh</Button>
        </div>
        {loading && <div className="text-xs text-muted-foreground">Memuat…</div>}
        {!loading && logs.length === 0 && <div className="text-xs text-muted-foreground p-3">Belum ada log.</div>}
        <div className="max-h-96 overflow-auto space-y-1.5">
          {logs.map((l) => (
            <div key={l.id} className={`text-[11px] p-2 rounded-md border ${l.level === "error" ? "bg-rose-500/10 border-rose-500/30" : "bg-muted/40"}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono opacity-70">{new Date(l.created_at).toLocaleString("id-ID")}</span>
                <span className="px-1.5 py-0.5 rounded bg-background border font-medium">{l.direction}</span>
                <span className="px-1.5 py-0.5 rounded bg-background border">{l.event}</span>
                {l.status && <span className="px-1.5 py-0.5 rounded bg-background border">{l.status}</span>}
                {l.error_code && <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-700 dark:text-rose-300">code {l.error_code}</span>}
              </div>
              {l.to_number && <div className="mt-1 opacity-80">→ {l.to_number}</div>}
              {l.error_message && <div className="mt-1 text-rose-700 dark:text-rose-300">{l.error_message}</div>}
              {l.message_sid && <div className="mt-0.5 font-mono opacity-60 truncate">SID: {l.message_sid}</div>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}




function ProductsTab() {
  const [products, setProducts] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  async function load() {
    const { data } = await supabase.from("products").select("*").order("sort_order");
    setProducts(data || []);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!name) return;
    const { error } = await supabase.from("products").insert({ name, description: desc });
    if (error) toast.error(error.message);
    else { setName(""); setDesc(""); load(); toast.success("Produk ditambahkan"); }
  }

  async function toggle(id: string, active: boolean) {
    await supabase.from("products").update({ is_active: !active }).eq("id", id);
    load();
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Hapus produk "${name}"? Referensi produk ini pada kontak & kode konten akan dikosongkan.`)) return;
    // Detach references first so FK tidak menolak
    await supabase.from("contacts").update({ interested_product_id: null }).eq("interested_product_id", id);
    await supabase.from("content_codes").update({ product_id: null }).eq("product_id", id);
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Produk dihapus");
    load();
  }

  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader><CardTitle>Tambah Produk</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Nama produk" value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea placeholder="Deskripsi (opsional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <Button onClick={add}>Tambah</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Daftar Produk</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {products.map((p) => (
              <div key={p.id} className="flex items-center justify-between border-b py-2 gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{p.name} {!p.is_active && <Badge variant="secondary">nonaktif</Badge>}</div>
                  <div className="text-xs text-muted-foreground">{p.description}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => toggle(p.id, p.is_active)}>
                    {p.is_active ? "Nonaktifkan" : "Aktifkan"}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => remove(p.id, p.name)}>
                    Hapus
                  </Button>
                </div>
              </div>
            ))}
            {!products.length && <p className="text-sm text-muted-foreground">Belum ada produk.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TeamTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const [isSuper, setIsSuper] = useState(false);

  // Add-agent form
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [position, setPosition] = useState("");
  const [phone, setPhone] = useState("62");
  const [role, setRole] = useState("agent");

  async function load() {
    setLoading(true);
    const [{ data: u }, { data: profiles }, { data: roles }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("profiles").select("id, email, full_name, position, phone, created_at").order("created_at"),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    setMe(u.user?.id || null);
    const roleMap: Record<string, string[]> = {};
    (roles || []).forEach((r: any) => { roleMap[r.user_id] = [...(roleMap[r.user_id] || []), r.role]; });
    setIsSuper((roleMap[u.user?.id || ""] || []).includes("super_admin"));
    setRows((profiles || []).map((p: any) => ({ ...p, roles: roleMap[p.id] || [] })));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function callManageAgent(body: any) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) throw new Error(j.error || "Gagal");
    return j;
  }

  function normPhone(v: string): string {
    const d = v.replace(/\D/g, "");
    if (!d) return "";
    if (d.startsWith("0")) return "62" + d.slice(1);
    if (d.startsWith("62")) return d;
    return "62" + d;
  }

  async function addAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim() || !email.trim() || password.length < 6) {
      toast.error("Nama, email, dan password (min 6) wajib diisi");
      return;
    }
    setBusy(true);
    try {
      await callManageAgent({ action: "create", full_name: fullName, email, password, position, phone: normPhone(phone), role });
      toast.success(`Agent ${fullName} ditambahkan`);
      setFullName(""); setEmail(""); setPassword(""); setPosition(""); setPhone("62"); setRole("agent");
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function deleteAgent(id: string, name: string) {
    if (id === me) { toast.error("Tidak bisa hapus akun sendiri"); return; }
    if (!confirm(`Hapus agent "${name}"? Aksi ini permanen.`)) return;
    setBusy(true);
    try {
      await callManageAgent({ action: "delete", user_id: id });
      toast.success("Agent dihapus");
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  if (!loading && !isSuper) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Tim Agent</CardTitle>
          <CardDescription>Hanya Super Admin yang dapat menambah, mengubah, atau menghapus agent.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Anda tidak memiliki akses ke pengelolaan tim.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Tambah Agent Baru</CardTitle>
          <CardDescription>
            Buat akun agent langsung — tanpa konfirmasi email. Pendaftaran mandiri di halaman login sudah dinonaktifkan, semua akun dibuat dari sini.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={addAgent} className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nama Lengkap</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Dr. Andi" />
            </div>
            <div className="space-y-1.5">
              <Label>Jabatan</Label>
              <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="cth: Front Office, Dokter, Supervisor" />
            </div>
            <div className="space-y-1.5">
              <Label>No. WhatsApp (62...)</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="6281234567890" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="agent@husada.id" />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimal 6 karakter" />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <select value={role} onChange={(e) => setRole(e.target.value)}
                className="w-full h-10 px-3 rounded-md border bg-background text-sm">
                <option value="agent">Agent</option>
                <option value="first_response">First Response Agent</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={busy} className="w-full md:w-auto">
                {busy && <Loader2 className="size-4 mr-2 animate-spin" />}Tambah Agent
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tim Agent ({rows.length})</CardTitle>
          <CardDescription>Edit nama, jabatan, dan nomor WhatsApp — klik <b>Simpan</b> untuk menyimpan perubahan.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Memuat...</div>
          ) : (
            <div className="border rounded-md divide-y">
              {rows.map((r) => (
                <AgentRow key={r.id} r={r} me={me} busy={busy}
                  onSave={async (patch) => {
                    await callManageAgent({ action: "update", user_id: r.id, ...patch });
                    toast.success("Perubahan disimpan");
                    load();
                  }}
                  onResetPassword={async (password) => {
                    await callManageAgent({ action: "reset_password", user_id: r.id, password });
                    toast.success("Password berhasil diganti");
                  }}
                  onDelete={() => deleteAgent(r.id, r.full_name || r.email)}
                />
              ))}
              {!rows.length && <p className="p-3 text-sm text-muted-foreground">Belum ada anggota tim.</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AgentRow({ r, me, busy, onSave, onResetPassword, onDelete }: {
  r: any; me: string | null; busy: boolean;
  onSave: (patch: any) => Promise<void>;
  onResetPassword: (password: string) => Promise<void>;
  onDelete: () => void;
}) {
  const [fullName, setFullName] = useState(r.full_name || "");
  const [position, setPosition] = useState(r.position || "");
  const [phone, setPhone] = useState(r.phone || "");
  const [role, setRole] = useState<string>((r.roles && r.roles[0]) || "agent");
  const [newPassword, setNewPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  useEffect(() => {
    setFullName(r.full_name || ""); setPosition(r.position || ""); setPhone(r.phone || "");
    setRole((r.roles && r.roles[0]) || "agent");
  }, [r.id, r.full_name, r.position, r.phone, JSON.stringify(r.roles)]);
  const currentRole = (r.roles && r.roles[0]) || "agent";
  const dirty = fullName !== (r.full_name || "") || position !== (r.position || "") || phone !== (r.phone || "") || role !== currentRole;

  async function save() {
    setSaving(true);
    try {
      const patch: any = {};
      if (fullName !== (r.full_name || "")) patch.full_name = fullName;
      if (position !== (r.position || "")) patch.position = position;
      if (phone !== (r.phone || "")) patch.phone = phone;
      if (role !== currentRole) patch.role = role;
      await onSave(patch);
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  async function resetPwd() {
    if (newPassword.length < 6) { toast.error("Password minimal 6 karakter"); return; }
    if (!confirm(`Ganti password untuk ${fullName || r.email}?`)) return;
    setResetting(true);
    try {
      await onResetPassword(newPassword);
      setNewPassword(""); setShowPwd(false);
    } catch (e: any) { toast.error(e.message); }
    finally { setResetting(false); }
  }

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-muted-foreground min-w-0 flex-1">
          <span className="font-mono">{r.email}</span>
          {r.id === me && <Badge variant="outline" className="ml-2 text-[10px]">Anda</Badge>}
          {r.roles.map((role: string) => (
            <Badge key={role} variant={role.includes("admin") ? "default" : "secondary"} className="ml-1 text-[10px]">{role}</Badge>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <TestNotifyButton agent={{ ...r, full_name: fullName, phone }} />
          <Button size="sm" variant="outline" onClick={() => setShowPwd((v) => !v)}>
            {showPwd ? "Batal" : "Ganti Password"}
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            {saving && <Loader2 className="size-3.5 mr-1 animate-spin" />} Simpan
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10"
            disabled={busy || r.id === me} onClick={onDelete}>
            Hapus
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Nama</Label>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nama lengkap" className="h-9 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Jabatan</Label>
          <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="cth: Dokter" className="h-9 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">No. WhatsApp</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="628..." className="h-9 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Role</Label>
          <select value={role} onChange={(e) => setRole(e.target.value)}
            disabled={r.id === me}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm">
            <option value="agent">Agent</option>
            <option value="first_response">First Response</option>
            <option value="admin">Admin</option>
            <option value="super_admin">Super Admin</option>
          </select>
        </div>
      </div>
      {showPwd && (
        <div className="flex items-end gap-2 pt-1 border-t mt-2">
          <div className="flex-1 space-y-1">
            <Label className="text-[11px] text-muted-foreground">Password Baru (min 6 karakter)</Label>
            <Input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Password baru untuk agent ini" className="h-9 text-sm" />
          </div>
          <Button size="sm" onClick={resetPwd} disabled={resetting || newPassword.length < 6}>
            {resetting && <Loader2 className="size-3.5 mr-1 animate-spin" />} Simpan Password
          </Button>
        </div>
      )}
    </div>
  );
}




function WorkflowTab() {
  const [stages, setStages] = useState<any[]>([]);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [counts, setCounts] = useState<Record<string, number>>({});

  async function load() {
    const [{ data: st }, { data: cs }] = await Promise.all([
      supabase.from("stages").select("*").order("order_index"),
      supabase.from("contacts").select("stage_id"),
    ]);
    setStages(st || []);
    const c: Record<string, number> = {};
    (cs || []).forEach((r: any) => { if (r.stage_id) c[r.stage_id] = (c[r.stage_id] || 0) + 1; });
    setCounts(c);
  }
  useEffect(() => { load(); }, []);

  async function update(id: string, patch: any) {
    const { error } = await supabase.from("stages").update(patch).eq("id", id);
    if (error) toast.error(error.message); else load();
  }

  async function move(id: string, dir: -1 | 1) {
    const i = stages.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= stages.length) return;
    const a = stages[i], b = stages[j];
    await Promise.all([
      supabase.from("stages").update({ order_index: b.order_index }).eq("id", a.id),
      supabase.from("stages").update({ order_index: a.order_index }).eq("id", b.id),
    ]);
    load();
  }

  async function add() {
    if (!newName.trim()) return toast.error("Nama stage wajib diisi");
    const nextIdx = (stages[stages.length - 1]?.order_index || 0) + 1;
    const { error } = await supabase.from("stages").insert({
      name: newName.trim(), color: newColor, order_index: nextIdx, is_default: false, is_terminal: false,
    });
    if (error) toast.error(error.message);
    else { setNewName(""); toast.success("Stage ditambahkan"); load(); }
  }

  async function remove(s: any) {
    if (counts[s.id]) return toast.error(`Tidak bisa dihapus: ${counts[s.id]} lead masih di stage ini.`);
    if (s.is_default) return toast.error("Stage default tidak dapat dihapus.");
    if (!confirm(`Hapus stage "${s.name}"?`)) return;
    const { error } = await supabase.from("stages").delete().eq("id", s.id);
    if (error) toast.error(error.message); else { toast.success("Stage dihapus"); load(); }
  }

  async function setDefault(id: string) {
    await supabase.from("stages").update({ is_default: false }).neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("stages").update({ is_default: true }).eq("id", id);
    toast.success("Default stage diperbarui");
    load();
  }

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Workflow Builder</CardTitle>
          <CardDescription>
            Atur stage pipeline: ubah nama, warna, urutan, tandai sebagai default (stage awal saat lead masuk) atau terminal (akhir).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2 p-3 rounded-xl border bg-muted/30">
            <div className="flex-1 min-w-[200px] space-y-1.5">
              <Label className="text-xs">Nama stage baru</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="cth: Negosiasi" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Warna</Label>
              <Input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="w-16 h-10 p-1" />
            </div>
            <Button onClick={add}>Tambah Stage</Button>
          </div>

          <div className="space-y-2">
            {stages.map((s, i) => (
              <div key={s.id} className="flex flex-wrap items-center gap-2 p-3 rounded-xl border bg-card">
                <span className="size-8 grid place-items-center rounded-lg bg-muted text-xs font-mono">{i + 1}</span>
                <Input type="color" value={s.color} onChange={(e) => update(s.id, { color: e.target.value })} className="w-12 h-9 p-1" />
                <Input value={s.name} onChange={(e) => setStages(stages.map((x) => x.id === s.id ? { ...x, name: e.target.value } : x))}
                  onBlur={() => update(s.id, { name: s.name })} className="flex-1 min-w-[160px]" />
                <Badge variant="outline" className="text-xs">{counts[s.id] || 0} lead</Badge>
                {s.is_default && <Badge className="bg-blue-500/15 text-blue-500 text-xs">Default</Badge>}
                {s.is_terminal && <Badge className="bg-emerald-500/15 text-emerald-500 text-xs">Terminal</Badge>}
                <div className="flex gap-1 ml-auto">
                  <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(s.id, -1)}>↑</Button>
                  <Button size="sm" variant="ghost" disabled={i === stages.length - 1} onClick={() => move(s.id, 1)}>↓</Button>
                  {!s.is_default && (
                    <Button size="sm" variant="outline" onClick={() => setDefault(s.id)}>Set Default</Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => update(s.id, { is_terminal: !s.is_terminal })}>
                    {s.is_terminal ? "Unset Terminal" : "Set Terminal"}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(s)}>Hapus</Button>
                </div>
              </div>
            ))}
            {!stages.length && <p className="text-sm text-muted-foreground">Belum ada stage.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TestNotifyButton({ agent }: { agent: any }) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [customMsg, setCustomMsg] = useState("");

  const defaultMsg = `Hi ${agent.full_name || "Agent"}, ini pesan test penugasan dari CRM Husada. Jika kamu menerima pesan ini, berarti nomor WhatsApp kamu sudah terhubung dengan benar.`;

  async function send() {
    if (!agent.phone) {
      toast.error("Agent belum punya nomor WhatsApp. Isi dulu di kolom 62...");
      return;
    }
    setSending(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-agent-assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({
        test: true,
        agent_id: agent.id,
        message: customMsg.trim() || defaultMsg,
      }),
    });
    const j = await res.json();
    setSending(false);
    if (res.ok && j.ok) {
      toast.success(`Pesan test terkirim ke ${agent.full_name}`);
      setOpen(false);
    } else {
      toast.error(j.error || j.skipped || "Gagal kirim. Cek API key & nomor agent.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={!agent.phone} title={!agent.phone ? "Isi nomor WhatsApp dulu" : "Kirim pesan test"}>
          <Send className="size-3.5 mr-1" /> Test
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Test Kirim Notif ke {agent.full_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Nomor: <span className="font-mono">{agent.phone || "—"}</span>
          </div>
          <div className="space-y-1.5">
            <Label>Pesan (opsional, kosongkan untuk default)</Label>
            <Textarea rows={4} placeholder={defaultMsg} value={customMsg} onChange={(e) => setCustomMsg(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
          <Button onClick={send} disabled={sending}>
            {sending && <Loader2 className="size-4 mr-2 animate-spin" />} Kirim Test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


const DAY_LABELS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

function ShiftsTab() {
  const [shifts, setShifts] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("16:00");
  const [color, setColor] = useState("#0ea5e9");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: sh }, { data: pf }, { data: asg }] = await Promise.all([
      supabase.from("shifts").select("*").order("start_time"),
      supabase.from("profiles").select("id, full_name, email, position"),
      supabase.from("agent_shifts").select("*"),
    ]);
    setShifts((sh as any[]) || []);
    setAgents((pf as any[]) || []);
    setAssignments((asg as any[]) || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function addShift() {
    if (!name.trim() || !days.length) return toast.error("Nama & minimal 1 hari wajib diisi");
    setBusy(true);
    const { error } = await supabase.from("shifts").insert({
      name: name.trim(), start_time: start, end_time: end, color, days_of_week: days, is_active: true,
    } as any);
    setBusy(false);
    if (error) return toast.error(error.message);
    setName(""); load();
    toast.success("Shift dibuat");
  }

  async function removeShift(id: string) {
    if (!confirm("Hapus shift ini? Semua assignment agent ke shift ini ikut terhapus.")) return;
    const { error } = await supabase.from("shifts").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Shift dihapus"); load(); }
  }

  async function toggleAgentShift(agentId: string, shiftId: string, on: boolean) {
    if (on) {
      const { error } = await supabase.from("agent_shifts").insert({ agent_id: agentId, shift_id: shiftId } as any);
      if (error && !error.message.includes("duplicate")) return toast.error(error.message);
    } else {
      const row = assignments.find((a) => a.agent_id === agentId && a.shift_id === shiftId);
      if (row) await supabase.from("agent_shifts").delete().eq("id", row.id);
    }
    load();
  }

  if (loading) return <div className="mt-4 text-sm text-muted-foreground">Memuat…</div>;

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Buat Shift Baru</CardTitle>
          <CardDescription>
            Definisikan window jam kerja. Metrik First Response di dashboard dihitung <b>hanya di dalam jam shift</b> agent.
            <br />
            <span className="text-primary">Tips:</span> untuk agent dengan jam berbeda tiap hari (mis. Senin pagi, Selasa siang, Rabu sore),
            buat beberapa shift terpisah — mis. <b>Senin Pagi (08–12, hari: Sen)</b>, <b>Selasa Siang (12–17, hari: Sel)</b>, <b>Rabu Sore (16–21, hari: Rab)</b>,
            lalu centang agent yang sama di ketiga shift tsb. Shift juga bisa dipindah sewaktu-waktu tanpa menghapus history.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
            <div className="md:col-span-2 space-y-1.5">
              <Label>Nama Shift</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="cth: Pagi" />
            </div>
            <div className="space-y-1.5">
              <Label>Mulai</Label>
              <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Selesai</Label>
              <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Warna</Label>
              <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 p-1" />
            </div>
            <div className="flex items-end">
              <Button onClick={addShift} disabled={busy} className="w-full">Tambah</Button>
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between flex-wrap gap-1">
              <Label className="text-xs text-muted-foreground">Hari aktif</Label>
              <div className="flex gap-1 flex-wrap">
                <button type="button" onClick={() => setDays([1,2,3,4,5])} className="text-[10px] px-2 py-0.5 rounded border hover:bg-accent">Sen–Jum</button>
                <button type="button" onClick={() => setDays([0,6])} className="text-[10px] px-2 py-0.5 rounded border hover:bg-accent">Weekend</button>
                <button type="button" onClick={() => setDays([0,1,2,3,4,5,6])} className="text-[10px] px-2 py-0.5 rounded border hover:bg-accent">Setiap hari</button>
                <button type="button" onClick={() => setDays([])} className="text-[10px] px-2 py-0.5 rounded border hover:bg-accent">Kosongkan</button>
              </div>
            </div>
            <div className="flex gap-1 flex-wrap mt-1.5">
              {DAY_LABELS.map((d, i) => {
                const on = days.includes(i);
                return (
                  <button key={i} type="button" onClick={() => setDays(on ? days.filter((x) => x !== i) : [...days, i].sort())}
                    className={`px-3 py-1.5 rounded-md text-xs border ${on ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"}`}>
                    {d}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">Untuk 1 shift 1 hari saja, kosongkan lalu pilih 1 hari — mis. "Selasa Siang".</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Daftar Shift ({shifts.length})</CardTitle></CardHeader>
        <CardContent>
          {shifts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada shift. Buat dulu di atas.</p>
          ) : (
            <div className="space-y-2">
              {shifts.map((s) => (
                <div key={s.id} className="border rounded-lg p-3 flex items-center gap-3 flex-wrap">
                  <span className="size-4 rounded" style={{ background: s.color }} />
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs font-mono text-muted-foreground">{s.start_time?.slice(0, 5)} – {s.end_time?.slice(0, 5)}</span>
                  <div className="flex gap-1 flex-wrap">
                    {(s.days_of_week || []).map((d: number) => (
                      <Badge key={d} variant="outline" className="text-[10px]">{DAY_LABELS[d]}</Badge>
                    ))}
                  </div>
                  <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => removeShift(s.id)}>Hapus</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assign Agent ke Shift</CardTitle>
          <CardDescription>Centang shift yang agent ini jaga. Bisa lebih dari satu shift.</CardDescription>
        </CardHeader>
        <CardContent>
          {shifts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Buat shift dulu.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-muted-foreground border-b">
                    <th className="py-2 pr-3">Agent</th>
                    {shifts.map((s) => (
                      <th key={s.id} className="py-2 px-2 text-center">
                        <span className="inline-flex items-center gap-1">
                          <span className="size-2 rounded-full" style={{ background: s.color }} />
                          {s.name}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => (
                    <tr key={a.id} className="border-b last:border-0 hover:bg-accent/30">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{a.full_name || a.email}</div>
                        {a.position && <div className="text-[10px] text-muted-foreground">{a.position}</div>}
                      </td>
                      {shifts.map((s) => {
                        const on = !!assignments.find((x) => x.agent_id === a.id && x.shift_id === s.id);
                        return (
                          <td key={s.id} className="py-2 px-2 text-center">
                            <input type="checkbox" checked={on}
                              onChange={(e) => toggleAgentShift(a.id, s.id, e.target.checked)}
                              className="size-4 cursor-pointer" />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}



