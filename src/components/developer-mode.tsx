import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Lock, ShieldCheck, Server, Copy, Database, RefreshCw } from "lucide-react";

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

type VpsCfg = {
  vps_host: string;
  vps_ssh_user: string;
  vps_pg_port: string;
  vps_pg_db: string;
  vps_pg_user: string;
  vps_mirror_enabled: string;
  vps_last_sync_at: string;
};

const CFG_KEYS: (keyof VpsCfg)[] = [
  "vps_host", "vps_ssh_user", "vps_pg_port", "vps_pg_db", "vps_pg_user",
  "vps_mirror_enabled", "vps_last_sync_at",
];

/** Panel konfigurasi + tutorial mirroring database ke VPS sendiri. */
export function VpsMirrorPanel() {
  const [cfg, setCfg] = useState<VpsCfg>({
    vps_host: "", vps_ssh_user: "root", vps_pg_port: "5432",
    vps_pg_db: "husada", vps_pg_user: "husada", vps_mirror_enabled: "false", vps_last_sync_at: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("system_settings").select("key,value").in("key", CFG_KEYS as string[]);
      const next = { ...cfg };
      (data || []).forEach((r: any) => { if (r.value != null) (next as any)[r.key] = r.value; });
      setCfg(next);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setSaving(true);
    const rows = CFG_KEYS.map((k) => ({ key: k, value: cfg[k] ?? "" }));
    const { error } = await supabase.from("system_settings").upsert(rows, { onConflict: "key" });
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Konfigurasi VPS disimpan");
  }

  const host = cfg.vps_host || "IP_VPS_ANDA";
  const pgUser = cfg.vps_pg_user || "husada";
  const pgDb = cfg.vps_pg_db || "husada";
  const pgPort = cfg.vps_pg_port || "5432";

  const snippets = useMemo(() => ({
    prepare: `# 1) Siapkan Postgres di VPS (Ubuntu 22.04+)
sudo apt update && sudo apt install -y postgresql-16 postgresql-client-16
sudo -u postgres psql -c "CREATE USER ${pgUser} WITH PASSWORD 'GANTI_PASSWORD' SUPERUSER;"
sudo -u postgres psql -c "CREATE DATABASE ${pgDb} OWNER ${pgUser};"

# Aktifkan koneksi luar + WAL logical (untuk replikasi realtime nanti)
sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" /etc/postgresql/16/main/postgresql.conf
echo "wal_level = logical" | sudo tee -a /etc/postgresql/16/main/postgresql.conf
echo "host all all 0.0.0.0/0 scram-sha-256" | sudo tee -a /etc/postgresql/16/main/pg_hba.conf
sudo systemctl restart postgresql

# Batasi akses hanya dari IP yang dipercaya
sudo ufw allow from 0.0.0.0/0 to any port ${pgPort} proto tcp`,

    mirror: `# 2) Mirroring berkala (cron di VPS) — snapshot penuh, aman & sederhana
# Simpan connection string cloud di file rahasia:
sudo install -m 600 /dev/null /root/.husada_cloud_url
echo 'postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres' | sudo tee /root/.husada_cloud_url >/dev/null

sudo tee /usr/local/bin/husada-mirror.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SRC=$(cat /root/.husada_cloud_url)
STAMP=$(date +%F_%H%M)
DIR=/var/backups/husada; mkdir -p "$DIR"
pg_dump --no-owner --no-privileges -Fc "$SRC" -f "$DIR/cloud_$STAMP.dump"
pg_restore --clean --if-exists --no-owner --no-privileges \\
  -d "postgresql://${pgUser}@127.0.0.1:${pgPort}/${pgDb}" "$DIR/cloud_$STAMP.dump"
find "$DIR" -name 'cloud_*.dump' -mtime +14 -delete
EOF
sudo chmod +x /usr/local/bin/husada-mirror.sh

# Jalankan tiap jam
( sudo crontab -l 2>/dev/null; echo "0 * * * * /usr/local/bin/husada-mirror.sh >> /var/log/husada-mirror.log 2>&1" ) | sudo crontab -`,

    realtime: `# 3) (Opsional) Mirroring nyaris realtime — logical replication
# Di database cloud (sumber):
CREATE PUBLICATION husada_pub FOR ALL TABLES;

# Di VPS (tujuan) — struktur tabel harus sudah ada (hasil pg_restore --schema-only):
CREATE SUBSCRIPTION husada_sub
  CONNECTION 'postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres'
  PUBLICATION husada_pub
  WITH (copy_data = true, create_slot = true);

-- Cek status:
SELECT * FROM pg_stat_subscription;`,

    selfhost: `# 4) Jalankan stack Supabase (Auth + Realtime + Storage + API) di VPS
git clone --depth 1 https://github.com/supabase/supabase /opt/supabase
cd /opt/supabase/docker && cp .env.example .env

# Edit .env: POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY,
# SITE_URL=https://crm.webhaus.id, API_EXTERNAL_URL=https://api.${host}
docker compose up -d

# Hemat RAM (VPS 4GB): matikan service berat
docker compose stop studio analytics imgproxy vector`,

    cutover: `# 5) Cutover — pindah app Lovable ke VPS (tanpa kehilangan data)
# a. Hentikan sementara traffic masuk (matikan webhook Twilio 5 menit)
# b. Jalankan mirroring terakhir:
sudo /usr/local/bin/husada-mirror.sh
# c. Salin file Storage (media chat):
#    supabase storage cp -r ss:///chat-media ./chat-media  →  upload ke storage VPS
# d. Ganti environment app di Lovable menjadi endpoint VPS:
#    VITE_SUPABASE_URL      = https://api.${host}
#    VITE_SUPABASE_PUBLISHABLE_KEY = ANON_KEY dari .env VPS
#    SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY = milik VPS
# e. Arahkan webhook Twilio ke: https://api.${host}/functions/v1/twilio-webhook
# f. Nyalakan kembali traffic, pantau /settings → Log Gateway
# g. Setelah 7 hari stabil & backup aman → database cloud boleh dimatikan`,

    verify: `# 6) Verifikasi tidak ada data hilang (jalankan di VPS)
psql "postgresql://${pgUser}@127.0.0.1:${pgPort}/${pgDb}" -c "
SELECT 'contacts' t, count(*) FROM contacts
UNION ALL SELECT 'conversations', count(*) FROM conversations
UNION ALL SELECT 'messages', count(*) FROM messages
UNION ALL SELECT 'audit_events', count(*) FROM audit_events;"
# Bandingkan angkanya dengan hasil query yang sama di database cloud.`,
  }), [host, pgUser, pgDb, pgPort]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="size-5" /> Database Mirroring ke VPS
            {cfg.vps_mirror_enabled === "true"
              ? <Badge className="bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">Aktif</Badge>
              : <Badge variant="outline">Nonaktif</Badge>}
          </CardTitle>
          <CardDescription>
            Simpan detail VPS di sini. Perintah di bawah otomatis menyesuaikan isian ini, jadi tinggal salin-tempel di server.
            Editing aplikasi tetap berjalan di Lovable — yang pindah hanya database & media.
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
                <Button onClick={save} disabled={saving}>{saving ? "Menyimpan…" : "Simpan Konfigurasi"}</Button>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Database className="size-5" /> Tutorial Migrasi &amp; Mirroring</CardTitle>
          <CardDescription>
            Urutan aman: mirroring dulu (data ganda di cloud + VPS), verifikasi jumlah baris, baru cutover.
            Database cloud hanya dimatikan setelah VPS terbukti stabil, jadi tidak ada data yang hilang.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <CodeBlock title="Langkah 1 — Siapkan Postgres di VPS" code={snippets.prepare} />
          <CodeBlock title="Langkah 2 — Mirroring otomatis tiap jam (cron)" code={snippets.mirror} />
          <CodeBlock title="Langkah 3 — Opsional: replikasi nyaris realtime" code={snippets.realtime} />
          <CodeBlock title="Langkah 4 — Jalankan Auth/Realtime/Storage di VPS" code={snippets.selfhost} />
          <CodeBlock title="Langkah 5 — Cutover ke VPS" code={snippets.cutover} />
          <CodeBlock title="Langkah 6 — Verifikasi data lengkap" code={snippets.verify} />

          <div className="rounded-lg border p-3 text-xs space-y-1.5 bg-muted/30">
            <p className="font-medium">Catatan penting</p>
            <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
              <li>Aplikasi Lovable hanya bicara lewat URL + API key, jadi setelah cutover semua editing di Lovable tetap jalan normal.</li>
              <li>Storage (media chat) tidak ikut <code>pg_dump</code> — salin bucket <code>chat-media</code> secara terpisah di langkah 5c.</li>
              <li>Wajib backup harian di VPS (<code>pg_dump</code> ke disk lain / S3) — cloud tidak lagi menyimpan cadangan setelah dimatikan.</li>
              <li>Spesifikasi minimum nyaman: 2 vCPU, 4 GB RAM, 50 GB NVMe, plus swap 2 GB.</li>
              <li>Simpan <code>JWT_SECRET</code>, <code>ANON_KEY</code>, dan <code>SERVICE_ROLE_KEY</code> VPS di tempat aman — kehilangan JWT_SECRET membuat semua sesi login rusak.</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
