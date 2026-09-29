import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function findPending(admin: any, webinarId: string) {
  const { data: w } = await admin.from("webinars").select("*").eq("id", webinarId).single();
  if (!w?.code) throw new Error("Webinar tidak ditemukan");
  const code = String(w.code).trim().toUpperCase();
  const esc = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^A-Z0-9])${esc}([^A-Z0-9]|$)`);
  const convIds = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from("messages").select("conversation_id,content")
      .eq("direction", "INBOUND").ilike("content", `%${code}%`).range(from, from + 999);
    (data || []).forEach((m: any) => { if (re.test(String(m.content || "").toUpperCase())) convIds.add(m.conversation_id); });
    if (!data || data.length < 1000) break;
  }
  const ids = [...convIds];
  const convs: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from("conversations").select("id,contact_id,contact:contacts(id,full_name,whatsapp_number)").in("id", ids.slice(i, i + 200));
    convs.push(...(data || []));
  }
  const { data: regs } = await admin.from("webinar_registrations").select("contact_id,conversation_id,message_sent").eq("webinar_id", webinarId);
  const done = new Set((regs || []).filter((r: any) => r.message_sent).flatMap((r: any) => [r.contact_id, r.conversation_id]));
  return { w, pending: convs.filter((c) => !done.has(c.contact_id) && !done.has(c.id)), regs: regs || [] };
}

async function requireAdmin(context: any) {
  const { data: isAdmin } = await context.supabase.rpc("is_admin", { _user_id: context.userId });
  if (!isAdmin) throw new Error("Hanya Admin yang bisa melakukan ini");
}

export const countPendingWebinarLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ webinar_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { pending } = await findPending(admin, data.webinar_id);
    return { count: pending.length };
  });

export const sendPendingWebinarLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ webinar_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { loadTwilioConfig, basicAuthHeader, toWhatsapp } = await import("./twilio.server");
    const cfg = await loadTwilioConfig(admin as any);
    if (!cfg.accountSid || !(cfg.authToken || cfg.apiKeySid) || !(cfg.whatsappFrom || cfg.messagingServiceSid)) throw new Error("Kredensial Twilio belum lengkap");
    const tokenAuth = cfg.authToken ? "Basic " + btoa(`${cfg.accountSid}:${cfg.authToken}`) : "";
    const { w, pending, regs } = await findPending(admin, data.webinar_id);

    let sent = 0, failed = 0; const errors: string[] = [];
    for (const c of pending.slice(0, 500)) {
      const ct = c.contact; if (!ct?.whatsapp_number) { failed++; continue; }
      const text = String(w.message_template || "")
        .replaceAll("{{link}}", w.zoom_link || "").replaceAll("{{webinar}}", w.name || "")
        .replaceAll("{{nama}}", ct.full_name || "").replaceAll("{{kode}}", w.code || "");
      const fd = new URLSearchParams();
      fd.append("To", toWhatsapp(ct.whatsapp_number));
      if (cfg.messagingServiceSid) fd.append("MessagingServiceSid", cfg.messagingServiceSid);
      else fd.append("From", toWhatsapp(cfg.whatsappFrom!));
      fd.append("Body", text);
      const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`;
      const go = (auth: string) => fetch(url, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" }, body: fd });
      let res = await go(basicAuthHeader(cfg)); let j: any = await res.json().catch(() => ({}));
      if ((!res.ok || j?.code) && cfg.apiKeySid && tokenAuth) { res = await go(tokenAuth); j = await res.json().catch(() => ({})); }
      if (!res.ok || j?.code) {
        failed++; const err = `${j?.code || res.status} ${j?.message || ""}`.trim(); errors.push(err);
        await admin.from("whatsapp_gateway_logs").insert({ direction: "OUTBOUND", level: "error", event: "webinar_link_manual", conversation_id: c.id, to_number: ct.whatsapp_number, status: "failed", error_message: err, payload: { webinar_id: w.id } });
        continue;
      }
      const now = new Date().toISOString();
      await admin.from("messages").insert({ conversation_id: c.id, direction: "OUTBOUND", type: "TEXT", content: text, sent_by_id: context.userId, fonnte_message_id: j?.sid || null, status: "SENT" });
      await admin.from("conversations").update({ last_message_at: now, last_message_preview: text.slice(0, 160), last_replied_by_id: context.userId }).eq("id", c.id);
      const existing = regs.find((r: any) => r.contact_id === ct.id && !r.message_sent);
      if (existing) await admin.from("webinar_registrations").update({ message_sent: text }).eq("webinar_id", w.id).eq("contact_id", ct.id).is("message_sent", null);
      else await admin.from("webinar_registrations").insert({ webinar_id: w.id, contact_id: ct.id, conversation_id: c.id, code_used: w.code, message_sent: text });
      if (w.stop_chatbot) await admin.from("contacts").update({ chatbot_state: "done" }).eq("id", ct.id);
      sent++;
    }
    return { sent, failed, errors: [...new Set(errors)].slice(0, 3) };
  });
