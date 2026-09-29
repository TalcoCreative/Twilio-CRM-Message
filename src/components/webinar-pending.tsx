import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { countPendingWebinarLinks, sendPendingWebinarLinks } from "@/lib/webinar-pending.functions";

export function WebinarPendingLinks({ webinarId, code }: { webinarId: string; code: string }) {
  const countFn = useServerFn(countPendingWebinarLinks);
  const sendFn = useServerFn(sendPendingWebinarLinks);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => countFn({ data: { webinar_id: webinarId } }).then((r) => setCount(r.count)).catch(() => setCount(null));
  useEffect(() => { load(); }, [webinarId]);

  async function send() {
    if (!confirm(`Kirim pesan + link Zoom ke ${count} chat yang pernah kirim "${code}" tapi belum dapat link?`)) return;
    setBusy(true);
    try {
      const r = await sendFn({ data: { webinar_id: webinarId } });
      toast.success(`Terkirim ${r.sent}, gagal ${r.failed}`, { description: r.errors.join(" · ") || undefined });
      load();
    } catch (e: any) { toast.error(e.message); }
    setBusy(false);
  }

  return (
    <div className="rounded-lg border p-3 flex items-center justify-between gap-2 flex-wrap">
      <div className="text-sm">
        <b>Chat "{code}" yang belum dapat link:</b> {count === null ? "…" : count}
        <p className="text-xs text-muted-foreground">Pesan baru dengan kode ini otomatis dibalas. Tombol ini untuk yang terlewat sebelumnya.</p>
      </div>
      <Button size="sm" onClick={send} disabled={busy || !count}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />} Kirim link ke yang belum
      </Button>
    </div>
  );
}
