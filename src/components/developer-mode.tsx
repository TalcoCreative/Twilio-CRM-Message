import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Lock, ShieldCheck, Server, Copy, Database, RefreshCw, Cloud, CloudOff, ListChecks, AlertTriangle, FileSpreadsheet, Download } from "lucide-react";

const DEV_PIN = "250321";
const SESSION_KEY = "husada_dev_mode_ok";

/** PIN gate — melindungi seluruh isi Developer Mode. */
export function DeveloperModeGate({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState(false);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem(SESSION_KEY) === "1") setOk(true);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pin.trim() === DEV_PIN) {
      sessionStorage.setItem(SESSION_KEY, "1");
      setOk(true);
      setErr("");
    } else {
      setErr("PIN salah. Coba lagi.");
      setPin("");
    }
  }

  function lock() {
    sessionStorage.removeItem(SESSION_KEY);
    setOk(false);
    setPin("");
  }

  if (!ok) {
    return (
      <div className="mt-4 flex justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Lock className="size-5" /> Developer Mode terkunci</CardTitle>
            <CardDescription>
              Area ini berisi kredensial gateway, log sistem, dan konfigurasi database. Masukkan PIN untuk membuka.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-3">
              <div className="space-y-1.5">
                <Label>PIN Akses</Label>
                <Input
                  type="password" inputMode="numeric" autoFocus value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="••••••" className="font-mono tracking-[0.4em] text-center"
                />
              </div>
              {err && <p className="text-xs text-destructive">{err}</p>}
              <Button type="submit" className="w-full">Buka Developer Mode</Button>
              <p className="text-[11px] text-muted-foreground text-center">
                Akses otomatis terkunci lagi saat tab browser ditutup.
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 mt-4 p-2.5 rounded-xl border bg-emerald-500/10 border-emerald-500/30">
        <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
          <ShieldCheck className="size-4" /> <span className="font-medium">Developer Mode aktif</span>
        </div>
        <Button size="sm" variant="outline" onClick={lock}><Lock className="size-3.5 mr-1" /> Kunci</Button>
      </div>
      {children}
    </div>
  );
}

function CodeBlock({ title, code }: { title?: string; code: string }) {
  return (
    <div className="rounded-lg border bg-muted/40 overflow-hidden">
      {title && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/60">
          <span className="text-[11px] font-medium text-muted-foreground">{title}</span>
          <Button size="sm" variant="ghost" className="h-6 px-2"
            onClick={() => { navigator.clipboard.writeText(code); toast.success("Disalin"); }}>
            <Copy className="size-3" />
          </Button>
        </div>
      )}
      <pre className="p-3 text-[11px] leading-relaxed overflow-x-auto font-mono whitespace-pre">{code}</pre>
    </div>
  );
}

/** Seluruh tabel public yang wajib ikut termirror. */
const PUBLIC_TABLES = [
  "activity_logs", "agent_shifts", "assignment_invitations", "audit_events", "contacts",
  "content_codes", "conversations", "fr_date_shifts", "messages", "products", "profiles",
  "shifts", "stages", "system_settings", "templates", "user_roles", "whatsapp_gateway_logs",
  "workflow_steps", "workflows",
] as const;

/** Objek non-tabel yang juga harus ikut pindah. */
const EXTRA_OBJECTS = [
  { label: "Schema auth (akun login, sesi, identitas OAuth)", detail: "auth.users, auth.identities, auth.sessions" },
  { label: "Schema storage (metadata media chat)", detail: "storage.buckets, storage.objects — file fisik disalin terpisah" },
  { label: "Bucket file chat-media", detail: "gambar, video, voice note, dokumen" },
  { label: "Enum & tipe kustom", detail: "app_role, conversation_status, message_direction, message_status, message_type" },
  { label: "Function & trigger", detail: "has_role, is_admin, fr_can_see_*, handle_new_user, log_* , touch_updated_at" },
  { label: "RLS policy + GRANT", detail: "ikut otomatis pada pg_dump seluruh database" },
  { label: "Secret Twilio & API key", detail: "TWILIO_* , SUPABASE_* — diisi ulang di .env VPS" },
];

type VpsCfg = {
  vps_host: string;
  vps_ssh_user: string;
  vps_pg_port: string;
  vps_pg_db: string;
  vps_pg_user: string;
  vps_api_url: string;
  vps_anon_key: string;
  vps_mirror_enabled: string;
  vps_last_sync_at: string;
  data_backend_mode: string; // cloud | dual | vps
};

const CFG_KEYS: (keyof VpsCfg)[] = [
  "vps_host", "vps_ssh_user", "vps_pg_port", "vps_pg_db", "vps_pg_user",
  "vps_api_url", "vps_anon_key", "vps_mirror_enabled", "vps_last_sync_at", "data_backend_mode",
];

const MODES = [
  { id: "cloud", label: "Lovable Cloud saja", desc: "Kondisi sekarang. Semua data di cloud, VPS tidak dipakai." },
  { id: "dual", label: "Lovable + VPS (mirroring)", desc: "Cloud tetap utama, VPS menerima salinan penuh tiap jam. Paling aman." },
  { id: "vps", label: "VPS saja (cloud dimatikan)", desc: "App membaca dari VPS. Cloud boleh dinonaktifkan setelah verifikasi." },
];

/** Panel konfigurasi + tutorial mirroring database ke VPS sendiri. */
export function VpsMirrorPanel() {
  const [cfg, setCfg] = useState<VpsCfg>({
    vps_host: "", vps_ssh_user: "root", vps_pg_port: "5432",
    vps_pg_db: "husada", vps_pg_user: "husada", vps_api_url: "", vps_anon_key: "",
    vps_mirror_enabled: "false", vps_last_sync_at: "", data_backend_mode: "cloud",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [counting, setCounting] = useState(false);
  const [confirmMode, setConfirmMode] = useState<string | null>(null);
  const [ack, setAck] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("system_settings").select("key,value").in("key", CFG_KEYS as string[]);
      setCfg((prev) => {
        const next = { ...prev };
        (data || []).forEach((r: any) => { if (r.value != null) (next as any)[r.key] = r.value; });
        return next;
      });
      setLoading(false);
    })();
  }, []);

  async function save(patch?: Partial<VpsCfg>) {
    const merged = { ...cfg, ...(patch || {}) };
    setSaving(true);
    const rows = CFG_KEYS.map((k) => ({ key: k, value: merged[k] ?? "" }));
    const { error } = await supabase.from("system_settings").upsert(rows, { onConflict: "key" });
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Konfigurasi tersimpan");
  }

  async function countRows() {
    setCounting(true);
    const result: Record<string, number | null> = {};
    for (const t of PUBLIC_TABLES) {
      const { count, error } = await supabase.from(t as any).select("*", { count: "exact", head: true });
      result[t] = error ? null : (count ?? 0);
    }
    setCounts(result);
    setCounting(false);
    toast.success("Jumlah baris cloud diperbarui");
  }

  function applyMode(id: string) {
    if (id === cfg.data_backend_mode) return;
    setAck(false);
    setConfirmMode(id);
  }

  const host = cfg.vps_host || "IP_VPS_ANDA";
  const pgUser = cfg.vps_pg_user || "husada";
  const pgDb = cfg.vps_pg_db || "husada";
  const pgPort = cfg.vps_pg_port || "5432";
  const apiUrl = cfg.vps_api_url || `https://api.${host}`;

  const totalRows = useMemo(
    () => Object.values(counts).reduce<number>((a, b) => a + (b ?? 0), 0),
    [counts],
  );

  const snippets = useMemo(() => ({
    prepare: `# 1) Siapkan Postgres di VPS (Ubuntu 22.04+)
sudo apt update && sudo apt install -y postgresql-16 postgresql-client-16
sudo -u postgres psql -c "CREATE USER ${pgUser} WITH PASSWORD 'GANTI_PASSWORD' SUPERUSER;"
sudo -u postgres psql -c "CREATE DATABASE ${pgDb} OWNER ${pgUser};"

# Role bawaan Supabase (wajib, agar GRANT & RLS ikut terpasang)
sudo -u postgres psql -d ${pgDb} <<'SQL'
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN NOINHERIT;
  CREATE ROLE authenticated NOLOGIN NOINHERIT;
  CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'GANTI_PASSWORD';
  CREATE ROLE supabase_auth_admin NOINHERIT LOGIN PASSWORD 'GANTI_PASSWORD' CREATEROLE;
  CREATE ROLE supabase_storage_admin NOINHERIT LOGIN PASSWORD 'GANTI_PASSWORD' CREATEROLE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT anon, authenticated, service_role TO authenticator;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
SQL

# Aktifkan koneksi luar + WAL logical (untuk replikasi realtime nanti)
sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" /etc/postgresql/16/main/postgresql.conf
echo "wal_level = logical" | sudo tee -a /etc/postgresql/16/main/postgresql.conf
echo "host all all 0.0.0.0/0 scram-sha-256" | sudo tee -a /etc/postgresql/16/main/pg_hba.conf
sudo systemctl restart postgresql
sudo ufw allow from 0.0.0.0/0 to any port ${pgPort} proto tcp`,

    mirror: `# 2) Mirroring SELURUH database (public + auth + storage) tiap jam
sudo install -m 600 /dev/null /root/.husada_cloud_url
echo 'postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres' | sudo tee /root/.husada_cloud_url >/dev/null

sudo tee /usr/local/bin/husada-mirror.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SRC=$(cat /root/.husada_cloud_url)
DST="postgresql://${pgUser}@127.0.0.1:${pgPort}/${pgDb}"
STAMP=$(date +%F_%H%M)
DIR=/var/backups/husada; mkdir -p "$DIR"

# Dump seluruh schema aplikasi + akun login + metadata storage
pg_dump --no-owner --no-privileges -Fc \\
  --schema=public --schema=auth --schema=storage \\
  "$SRC" -f "$DIR/cloud_$STAMP.dump"

pg_restore --clean --if-exists --no-owner --no-privileges -d "$DST" "$DIR/cloud_$STAMP.dump"
find "$DIR" -name 'cloud_*.dump' -mtime +14 -delete
EOF
sudo chmod +x /usr/local/bin/husada-mirror.sh

( sudo crontab -l 2>/dev/null; echo "0 * * * * /usr/local/bin/husada-mirror.sh >> /var/log/husada-mirror.log 2>&1" ) | sudo crontab -`,

    media: `# 3) Mirroring file media (bucket chat-media) tiap jam
# Pakai rclone dengan endpoint S3 Supabase Storage
sudo apt install -y rclone
rclone config create supa s3 provider=Other \\
  access_key_id=STORAGE_ACCESS_KEY secret_access_key=STORAGE_SECRET_KEY \\
  endpoint=https://PROJECT.supabase.co/storage/v1/s3 region=ap-southeast-1

rclone sync supa:chat-media /var/lib/husada/chat-media --fast-list -P
( sudo crontab -l 2>/dev/null; echo "15 * * * * rclone sync supa:chat-media /var/lib/husada/chat-media >> /var/log/husada-media.log 2>&1" ) | sudo crontab -`,

    realtime: `# 4) (Opsional) Mirroring nyaris realtime — logical replication
-- Di database cloud (sumber):
CREATE PUBLICATION husada_pub FOR ALL TABLES;

-- Di VPS (struktur harus sudah ada dari pg_restore --schema-only):
CREATE SUBSCRIPTION husada_sub
  CONNECTION 'postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres'
  PUBLICATION husada_pub
  WITH (copy_data = true, create_slot = true);

SELECT * FROM pg_stat_subscription;`,

    selfhost: `# 5) Jalankan stack Supabase (Auth + Realtime + Storage + API) di VPS
git clone --depth 1 https://github.com/supabase/supabase /opt/supabase
cd /opt/supabase/docker && cp .env.example .env

# Isi .env:
#   POSTGRES_HOST=127.0.0.1  POSTGRES_DB=${pgDb}  POSTGRES_PORT=${pgPort}
#   JWT_SECRET / ANON_KEY / SERVICE_ROLE_KEY  (generate baru, simpan aman)
#   SITE_URL=https://crm.webhaus.id
#   API_EXTERNAL_URL=${apiUrl}
docker compose up -d

# Hemat RAM (VPS 4GB): matikan service berat
docker compose stop studio analytics imgproxy vector`,

    cutover: `# 6) Cutover — pindah app ke VPS tanpa kehilangan data
# a. Matikan sementara webhook Twilio (5 menit)
# b. Mirroring terakhir: sudo /usr/local/bin/husada-mirror.sh && rclone sync supa:chat-media /var/lib/husada/chat-media
# c. Ganti environment app di Lovable:
#      VITE_SUPABASE_URL             = ${apiUrl}
#      VITE_SUPABASE_PUBLISHABLE_KEY = ANON_KEY dari .env VPS
#      SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY = milik VPS
# d. Arahkan webhook Twilio ke: ${apiUrl}/functions/v1/twilio-webhook
# e. Nyalakan traffic, pantau Developer Mode → Log Gateway
# f. Setelah 7 hari stabil & backup jalan → database cloud boleh dimatikan`,

    verify: `# 7) Verifikasi tidak ada data hilang — jalankan di VPS, bandingkan dengan tabel di atas
psql "postgresql://${pgUser}@127.0.0.1:${pgPort}/${pgDb}" -c "
${PUBLIC_TABLES.map((t, i) => `${i === 0 ? "SELECT" : "UNION ALL SELECT"} '${t}' AS tabel, count(*) FROM public.${t}`).join("\n")}
UNION ALL SELECT 'auth.users', count(*) FROM auth.users
UNION ALL SELECT 'storage.objects', count(*) FROM storage.objects
ORDER BY 1;"`,
  }), [host, pgUser, pgDb, pgPort, apiUrl]);

  return (
    <div className="space-y-4">
      {/* ---- Mode sumber data ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Cloud className="size-5" /> Sumber Data Aktif</CardTitle>
          <CardDescription>
            Pilih dari mana aplikasi mengambil data. Perpindahan bersifat bertahap: mulai dari mirroring ganda,
            baru matikan cloud setelah jumlah baris di VPS sama persis.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-3">
          {MODES.map((m) => {
            const active = cfg.data_backend_mode === m.id;
            return (
              <button key={m.id} type="button" onClick={() => applyMode(m.id)}
                className={`text-left rounded-xl border p-3 transition ${active ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "hover:bg-muted/50"}`}>
                <div className="flex items-center gap-2 mb-1">
                  {m.id === "vps" ? <CloudOff className="size-4" /> : <Server className="size-4" />}
                  <span className="text-sm font-medium">{m.label}</span>
                  {active && <Badge className="ml-auto bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">Aktif</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{m.desc}</p>
              </button>
            );
          })}
          <div className="md:col-span-3 rounded-lg border p-3 text-xs text-muted-foreground bg-muted/30 flex gap-2">
            <AlertTriangle className="size-4 shrink-0 text-amber-500" />
            <span>
              Mode ini menyimpan keputusan arsitektur dan mengunci langkah tutorial yang harus dijalankan.
              Perpindahan endpoint sesungguhnya terjadi saat variabel <code>VITE_SUPABASE_URL</code> &amp; key diganti (Langkah 6c) —
              data lama tidak terhapus, cloud hanya berhenti menerima traffic baru.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ---- Konfigurasi VPS ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="size-5" /> Database Mirroring ke VPS
            {cfg.vps_mirror_enabled === "true"
              ? <Badge className="bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">Aktif</Badge>
              : <Badge variant="outline">Nonaktif</Badge>}
          </CardTitle>
          <CardDescription>
            Semua perintah di bawah otomatis menyesuaikan isian ini. Editing aplikasi tetap di Lovable — yang pindah hanya database &amp; media.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? <div className="text-sm text-muted-foreground">Memuat…</div> : (
            <>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>IP / Hostname VPS</Label>
                  <Input value={cfg.vps_host} onChange={(e) => setCfg({ ...cfg, vps_host: e.target.value })}
                    placeholder="203.0.113.10" className="font-mono text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label>User SSH</Label>
                  <Input value={cfg.vps_ssh_user} onChange={(e) => setCfg({ ...cfg, vps_ssh_user: e.target.value })}
                    className="font-mono text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label>Nama Database</Label>
                  <Input value={cfg.vps_pg_db} onChange={(e) => setCfg({ ...cfg, vps_pg_db: e.target.value })}
                    className="font-mono text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label>User Postgres</Label>
                  <Input value={cfg.vps_pg_user} onChange={(e) => setCfg({ ...cfg, vps_pg_user: e.target.value })}
                    className="font-mono text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label>Port Postgres</Label>
                  <Input value={cfg.vps_pg_port} onChange={(e) => setCfg({ ...cfg, vps_pg_port: e.target.value })}
                    className="font-mono text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label>API URL VPS (Kong/Nginx)</Label>
                  <Input value={cfg.vps_api_url} onChange={(e) => setCfg({ ...cfg, vps_api_url: e.target.value })}
                    placeholder="https://api.domain-anda.com" className="font-mono text-xs" />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>ANON KEY VPS</Label>
                  <Input value={cfg.vps_anon_key} onChange={(e) => setCfg({ ...cfg, vps_anon_key: e.target.value })}
                    placeholder="eyJhbGciOi…" className="font-mono text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label>Status Mirroring</Label>
                  <div className="flex gap-2">
                    <Button type="button" variant={cfg.vps_mirror_enabled === "true" ? "default" : "outline"} size="sm"
                      onClick={() => setCfg({ ...cfg, vps_mirror_enabled: "true" })}>Aktif</Button>
                    <Button type="button" variant={cfg.vps_mirror_enabled !== "true" ? "default" : "outline"} size="sm"
                      onClick={() => setCfg({ ...cfg, vps_mirror_enabled: "false" })}>Nonaktif</Button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => save()} disabled={saving}>{saving ? "Menyimpan…" : "Simpan Konfigurasi"}</Button>
                <Button variant="outline" onClick={() => {
                  setCfg({ ...cfg, vps_last_sync_at: new Date().toISOString() });
                  toast.info("Tandai waktu sinkron terakhir, lalu klik Simpan.");
                }}>
                  <RefreshCw className="size-3.5 mr-1.5" /> Tandai Sinkron Sekarang
                </Button>
                {cfg.vps_last_sync_at && (
                  <span className="self-center text-xs text-muted-foreground">
                    Sinkron terakhir: {new Date(cfg.vps_last_sync_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ---- Inventaris tabel ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ListChecks className="size-5" /> Daftar Data yang Harus Termirror</CardTitle>
          <CardDescription>
            {PUBLIC_TABLES.length} tabel aplikasi + schema auth &amp; storage. Ambil jumlah baris cloud di sini,
            lalu bandingkan dengan hasil query verifikasi (Langkah 7) di VPS.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={countRows} disabled={counting}>
              <RefreshCw className={`size-3.5 mr-1.5 ${counting ? "animate-spin" : ""}`} /> {counting ? "Menghitung…" : "Hitung Baris Cloud"}
            </Button>
            {!!Object.keys(counts).length && (
              <>
                <span className="text-xs text-muted-foreground">Total {totalRows.toLocaleString("id-ID")} baris</span>
                <Button size="sm" variant="outline" onClick={() => {
                  const txt = PUBLIC_TABLES.map((t) => `${t}\t${counts[t] ?? "-"}`).join("\n");
                  navigator.clipboard.writeText(txt);
                  toast.success("Daftar jumlah baris disalin");
                }}><Copy className="size-3.5 mr-1.5" /> Salin</Button>
              </>
            )}
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {PUBLIC_TABLES.map((t) => (
              <div key={t} className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs">
                <span className="font-mono truncate">{t}</span>
                <span className="text-muted-foreground tabular-nums shrink-0">
                  {counts[t] === undefined ? "—" : counts[t] === null ? "n/a" : counts[t]!.toLocaleString("id-ID")}
                </span>
              </div>
            ))}
          </div>

          <div className="rounded-lg border p-3 space-y-1.5 bg-muted/30">
            <p className="text-xs font-medium">Selain tabel di atas, ikut dipindahkan:</p>
            <ul className="text-xs text-muted-foreground space-y-1">
              {EXTRA_OBJECTS.map((o) => (
                <li key={o.label} className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span><span className="text-foreground">{o.label}</span> — {o.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* ---- Tutorial ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Database className="size-5" /> Tutorial Migrasi &amp; Mirroring</CardTitle>
          <CardDescription>
            Urutan aman: siapkan Postgres → mirroring database + media → verifikasi jumlah baris → cutover.
            Cloud hanya dimatikan setelah VPS terbukti stabil, jadi tidak ada data yang hilang.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <CodeBlock title="Langkah 1 — Siapkan Postgres + role Supabase" code={snippets.prepare} />
          <CodeBlock title="Langkah 2 — Mirroring seluruh database tiap jam" code={snippets.mirror} />
          <CodeBlock title="Langkah 3 — Mirroring file media (chat-media)" code={snippets.media} />
          <CodeBlock title="Langkah 4 — Opsional: replikasi nyaris realtime" code={snippets.realtime} />
          <CodeBlock title="Langkah 5 — Jalankan Auth/Realtime/Storage di VPS" code={snippets.selfhost} />
          <CodeBlock title="Langkah 6 — Cutover ke VPS" code={snippets.cutover} />
          <CodeBlock title="Langkah 7 — Verifikasi semua tabel lengkap" code={snippets.verify} />

          <div className="rounded-lg border p-3 text-xs space-y-1.5 bg-muted/30">
            <p className="font-medium">Data &amp; kredensial yang perlu disiapkan sebelum mulai</p>
            <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
              <li>Connection string Postgres cloud (host, user, password, port 5432).</li>
              <li>Storage S3 access key &amp; secret untuk menyalin bucket <code>chat-media</code>.</li>
              <li>Semua secret Twilio: <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code>, <code>TWILIO_API_KEY_SID</code>, <code>TWILIO_API_KEY_SECRET</code>, <code>TWILIO_WHATSAPP_NUMBER</code>, <code>TWILIO_MESSAGING_SERVICE_SID</code>.</li>
              <li><code>JWT_SECRET</code>, <code>ANON_KEY</code>, <code>SERVICE_ROLE_KEY</code> baru untuk VPS — simpan aman, hilangnya JWT_SECRET merusak semua sesi login.</li>
              <li>Domain/subdomain + sertifikat SSL untuk API VPS ({apiUrl}).</li>
              <li>Spesifikasi minimum nyaman: 2 vCPU, 4 GB RAM, 50 GB NVMe, swap 2 GB.</li>
              <li>Backup harian wajib di VPS — cloud tidak lagi menyimpan cadangan setelah dimatikan.</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!confirmMode} onOpenChange={(o) => { if (!o) setConfirmMode(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ubah sumber data ke "{MODES.find((m) => m.id === confirmMode)?.label}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmMode === "vps"
                ? "Pastikan mirroring sudah berjalan dan jumlah baris seluruh tabel di VPS sama dengan cloud. Setelah beralih, traffic baru hanya tersimpan di VPS."
                : confirmMode === "cloud"
                  ? "Aplikasi kembali sepenuhnya memakai Lovable Cloud. Data yang sudah masuk ke VPS tidak terhapus."
                  : "Cloud tetap jadi sumber utama, VPS menerima salinan penuh. Ini mode paling aman untuk masa transisi."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-start gap-2 text-xs">
            <Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} className="mt-0.5" />
            <span>Saya sudah memverifikasi jumlah baris seluruh tabel dan memiliki backup terbaru.</span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction disabled={!ack} onClick={() => {
              const id = confirmMode!;
              setCfg((p) => ({ ...p, data_backend_mode: id }));
              save({ data_backend_mode: id });
              setConfirmMode(null);
            }}>Terapkan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const WIB = "Asia/Jakarta";

async function fetchAllRows(buildQuery: () => any, pageSize = 1000): Promise<any[]> {
  const all: any[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

function wibDate(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("id-ID", { timeZone: WIB, day: "2-digit", month: "2-digit", year: "numeric" });
}
function wibTime(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("id-ID", { timeZone: WIB, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Export seluruh percakapan + isi chat inbox ke XLSX untuk review script. */
export function InboxExportPanel() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState("");

  async function exportInbox() {
    setExporting(true);
    try {
      setProgress("Mengambil profil, stage, produk…");
      const [profRes, stageRes, prodRes] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email"),
        supabase.from("stages").select("id, name").order("order_index"),
        supabase.from("products").select("id, name").eq("is_active", true),
      ]);
      const profMap: Record<string, string> = {};
      (profRes.data || []).forEach((p: any) => { profMap[p.id] = p.full_name || p.email || p.id; });
      const stageMap: Record<string, string> = {};
      (stageRes.data || []).forEach((s: any) => { stageMap[s.id] = s.name; });
      const prodMap: Record<string, string> = {};
      (prodRes.data || []).forEach((p: any) => { prodMap[p.id] = p.name; });

      setProgress("Mengambil seluruh kontak…");
      const contacts = await fetchAllRows(() =>
        supabase.from("contacts").select("id, full_name, whatsapp_number, stage_id, interested_product_id, source, created_at, need_category, domicile"));
      const contactMap: Record<string, any> = {};
      contacts.forEach((c) => { contactMap[c.id] = c; });

      setProgress("Mengambil seluruh percakapan…");
      const conversations = await fetchAllRows(() =>
        supabase.from("conversations").select("*").order("created_at", { ascending: true }));
      const convMap: Record<string, any> = {};
      conversations.forEach((c) => { convMap[c.id] = c; });

      setProgress("Mengambil seluruh pesan (ini bisa agak lama)…");
      let msgQ = () => {
        let q = supabase.from("messages").select("*").order("sent_at", { ascending: true });
        if (from) q = q.gte("sent_at", `${from}T00:00:00+07:00`);
        if (to) q = q.lte("sent_at", `${to}T23:59:59.999+07:00`);
        return q;
      };
      const messages = await fetchAllRows(msgQ);

      setProgress("Menyusun file Excel…");

      // Sheet 1 — Transkrip chat: 1 baris = 1 pesan
      const chatRows = messages.map((m: any) => {
        const conv = convMap[m.conversation_id] || {};
        const contact = contactMap[conv.contact_id] || {};
        const pengirim = m.direction === "INBOUND"
          ? (contact.full_name || contact.whatsapp_number || "Kontak")
          : (m.sent_by_id ? (profMap[m.sent_by_id] || "Sistem") : "Bot/Sistem");
        return {
          "Tanggal (WIB)": wibDate(m.sent_at),
          "Jam (WIB)": wibTime(m.sent_at),
          "Nama Kontak": contact.full_name || "",
          "No. WhatsApp": contact.whatsapp_number || "",
          "Arah": m.direction === "INBOUND" ? "Masuk" : "Keluar",
          "Pengirim": pengirim,
          "Tipe": m.type,
          "Isi Pesan": m.type === "INTERNAL_NOTE" ? `[CATATAN] ${m.content}` : m.content,
          "Media URL": m.media_url || "",
          "Status": m.status,
          "Stage Akhir": stageMap[contact.stage_id] || "",
          "Produk": prodMap[contact.interested_product_id] || "",
          "ID Percakapan": m.conversation_id,
        };
      });

      // Sheet 2 — Ringkasan per percakapan (hasil akhir)
      const convRows = conversations
        .filter((c: any) => messages.some((m: any) => m.conversation_id === c.id))
        .map((c: any) => {
          const contact = contactMap[c.contact_id] || {};
          const convMsgs = messages.filter((m: any) => m.conversation_id === c.id);
          const inbound = convMsgs.filter((m: any) => m.direction === "INBOUND").length;
          return {
            "Nama Kontak": contact.full_name || "",
            "No. WhatsApp": contact.whatsapp_number || "",
            "Sumber": contact.source || "",
            "Kategori Kebutuhan": contact.need_category || "",
            "Domisili": contact.domicile || "",
            "Stage Akhir": stageMap[contact.stage_id] || "",
            "Produk": prodMap[contact.interested_product_id] || "",
            "Status Percakapan": c.status,
            "Agent Terakhir": c.assigned_agent_id ? (profMap[c.assigned_agent_id] || "") : "",
            "Total Pesan": convMsgs.length,
            "Pesan Masuk": inbound,
            "Pesan Keluar": convMsgs.length - inbound,
            "Pesan Pertama (WIB)": convMsgs.length ? `${wibDate(convMsgs[0].sent_at)} ${wibTime(convMsgs[0].sent_at)}` : "",
            "Pesan Terakhir (WIB)": convMsgs.length ? `${wibDate(convMsgs[convMsgs.length - 1].sent_at)} ${wibTime(convMsgs[convMsgs.length - 1].sent_at)}` : "",
            "Respon Pertama (detik)": convMsgs.find((m: any) => m.response_seconds != null)?.response_seconds ?? "",
          };
        });

      // Sheet 3 — Kontak/leads
      const contactRows = contacts.map((c: any) => ({
        "Nama": c.full_name || "",
        "No. WhatsApp": c.whatsapp_number,
        "Sumber": c.source || "",
        "Kategori Kebutuhan": c.need_category || "",
        "Domisili": c.domicile || "",
        "Stage": stageMap[c.stage_id] || "",
        "Produk": prodMap[c.interested_product_id] || "",
        "Dibuat (WIB)": `${wibDate(c.created_at)} ${wibTime(c.created_at)}`,
      }));

      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.json_to_sheet(chatRows);
      ws1["!cols"] = [{ wch: 11 }, { wch: 9 }, { wch: 22 }, { wch: 16 }, { wch: 7 }, { wch: 18 }, { wch: 10 }, { wch: 60 }, { wch: 30 }, { wch: 9 }, { wch: 14 }, { wch: 18 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws1, "Transkrip Chat");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(convRows), "Ringkasan Percakapan");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contactRows), "Kontak");

      const stamp = new Date().toLocaleDateString("id-ID", { timeZone: WIB }).replace(/\//g, "-");
      const range = from || to ? `_${from || "awal"}_sd_${to || "kini"}` : "";
      XLSX.writeFile(wb, `inbox-export-${stamp}${range}.xlsx`);
      toast.success(`Export selesai: ${messages.length.toLocaleString("id-ID")} pesan, ${convRows.length.toLocaleString("id-ID")} percakapan`);
    } catch (e: any) {
      toast.error("Export gagal: " + (e?.message || e));
    } finally {
      setExporting(false);
      setProgress("");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="size-5" /> Export Inbox (XLSX)</CardTitle>
        <CardDescription>
          Unduh seluruh isi inbox — transkrip chat per pesan, ringkasan per percakapan (stage &amp; produk akhir),
          dan daftar kontak. Cocok untuk review script dan audit hasil akhir.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3 max-w-md">
          <div className="space-y-1.5">
            <Label>Dari Tanggal (opsional)</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Sampai Tanggal (opsional)</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Kosongkan tanggal untuk export semua. Batas tanggal berlaku ke transkrip pesan (WIB).
        </p>
        <Button onClick={exportInbox} disabled={exporting}>
          {exporting ? <RefreshCw className="size-4 mr-1.5 animate-spin" /> : <Download className="size-4 mr-1.5" />}
          {exporting ? (progress || "Mengekspor…") : "Export Inbox ke XLSX"}
        </Button>
        {exporting && progress && <p className="text-xs text-muted-foreground">{progress}</p>}
      </CardContent>
    </Card>
  );
}
