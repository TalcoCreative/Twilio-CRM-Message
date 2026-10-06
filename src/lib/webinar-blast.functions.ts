import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const blastWebinar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ recipient_ids: z.array(z.string().uuid()).min(1).max(500), kind: z.enum(["blast", "reminder"]).default("blast") }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_admin", { _user_id: context.userId });
    if (!isAdmin) throw new Error("Hanya Admin yang bisa blasting webinar");
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { loadTwilioConfig, basicAuthHeader, normalizePhone, toWhatsapp } = await import("./twilio.server");

    const cfg = await loadTwilioConfig(admin as any);
    if (!cfg.accountSid || !(cfg.authToken || cfg.apiKeySid) || !(cfg.whatsappFrom || cfg.messagingServiceSid)) {
      throw new Error("Kredensial Twilio belum lengkap");
    }
    const isReminder = data.kind === "reminder";
    const { data: sidRow } = await admin.from("system_settings").select("value").eq("key", isReminder ? "twilio_content_sid_webinar_reminder" : "twilio_content_sid_webinar_blast").maybeSingle();
    const contentSid = (sidRow?.value || "").trim();
    if (!contentSid) throw new Error(isReminder ? "Content SID Webinar Reminder belum diisi" : "Content SID Webinar Blast belum diisi");
    const tokenAuth = cfg.authToken ? "Basic " + btoa(`${cfg.accountSid}:${cfg.authToken}`) : "";

    let templateBody = "";
    try {
      const url = `https://content.twilio.com/v1/Content/${encodeURIComponent(contentSid)}`;
      let r = await fetch(url, { headers: { Authorization: basicAuthHeader(cfg) } });
      if (!r.ok && tokenAuth) r = await fetch(url, { headers: { Authorization: tokenAuth } });
      const j: any = await r.json().catch(() => ({}));
      const t = j?.types || {};
      templateBody = t["twilio/text"]?.body || t["twilio/media"]?.body || t["twilio/quick-reply"]?.body
        || t["twilio/call-to-action"]?.body || t["twilio/card"]?.body || "";
    } catch (e) { console.warn("[webinar-blast] content fetch failed", e); }

    const sendTemplate = async (to: string, vars: Record<string, string>) => {
      const fd = new URLSearchParams();
      fd.append("To", toWhatsapp(to));
      if (cfg.messagingServiceSid) fd.append("MessagingServiceSid", cfg.messagingServiceSid);
      else fd.append("From", toWhatsapp(cfg.whatsappFrom!));
      fd.append("ContentSid", contentSid);
      fd.append("ContentVariables", JSON.stringify(vars));
      const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`;
      const go = (auth: string) => fetch(url, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" }, body: fd });
      let res = await go(basicAuthHeader(cfg));
      let j: any = await res.json().catch(() => ({}));
      if ((!res.ok || j?.code) && cfg.apiKeySid && tokenAuth) { res = await go(tokenAuth); j = await res.json().catch(() => ({})); }
      if (!res.ok || j?.code) return { ok: false as const, error: `${j?.code || res.status} ${j?.message || ""}`.trim(), raw: j };
      return { ok: true as const, sid: j?.sid as string };
    };

    const { data: recips } = await admin.from("webinar_blast_recipients").select("*").in("id", data.recipient_ids);
    const { data: defaultStage } = await admin.from("stages").select("id").eq("is_default", true)
      .order("order_index", { ascending: true }).limit(1).maybeSingle();

    let sent = 0, failed = 0;
    for (const r of recips || []) {
      if (isReminder && (r as any).reminder_status === "sent") continue;
      const fail = async (msg: string, extra: Record<string, any> = {}) => {
        failed++;
        await admin.from("webinar_blast_recipients").update((isReminder
          ? { reminder_status: "failed", reminder_error: msg, ...extra }
          : { last_status: "failed", last_error: msg, ...extra }) as any).eq("id", r.id);
      };
      const phone = normalizePhone(r.whatsapp_number);
      if (!phone) { await fail("Nomor tidak valid"); continue; }

      let { data: contact } = await admin.from("contacts").select("id, full_name").eq("whatsapp_number", phone).maybeSingle();
      if (!contact) {
        const { data: nc, error } = await admin.from("contacts").insert({
          whatsapp_number: phone, full_name: r.full_name || null, stage_id: defaultStage?.id || null,
          source: "organik", total_messages: 0, last_interaction_at: new Date().toISOString(),
        }).select("id, full_name").single();
        contact = error
          ? (await admin.from("contacts").select("id, full_name").eq("whatsapp_number", phone).maybeSingle()).data
          : nc;
      } else if (!contact.full_name && r.full_name) {
        await admin.from("contacts").update({ full_name: r.full_name }).eq("id", contact.id);
      }
      if (!contact) { await fail("Gagal membuat kontak"); continue; }

      let { data: conv } = await admin.from("conversations").select("id").eq("contact_id", contact.id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!conv) conv = (await admin.from("conversations").insert({ contact_id: contact.id, status: "OPEN" }).select("id").single()).data;
      if (!conv) { await fail("Gagal membuat percakapan", { contact_id: contact.id }); continue; }

      const name = (r.full_name || contact.full_name || "Bapak/Ibu").trim() || "Bapak/Ibu";
      const vars = { "1": name };
      const res = await sendTemplate(phone, vars);
      const now = new Date().toISOString();
      if (!res.ok) {
        await fail(res.error, { contact_id: contact.id, conversation_id: conv.id });
        await admin.from("whatsapp_gateway_logs").insert({
          direction: "OUTBOUND", level: "error", event: isReminder ? "webinar_reminder" : "webinar_blast", conversation_id: conv.id, to_number: phone,
          status: "failed", error_message: res.error, payload: { content_sid: contentSid, webinar_id: r.webinar_id, raw: res.raw },
        });
        continue;
      }
      const body = templateBody
        ? templateBody.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m: string, k: string) => (vars as any)[k] ?? "")
        : `${isReminder ? "[Reminder Webinar]" : "[Undangan Webinar]"} Halo ${name}`;
      await admin.from("messages").insert({
        conversation_id: conv.id, direction: "OUTBOUND", type: "TEXT", content: body,
        sent_by_id: context.userId, fonnte_message_id: res.sid || null, status: "SENT",
      });
      await admin.from("conversations").update({
        last_message_at: now, last_message_preview: body.slice(0, 160), last_replied_by_id: context.userId,
      }).eq("id", conv.id);
      await admin.from("webinar_blast_recipients").update((isReminder
        ? { contact_id: contact.id, conversation_id: conv.id, reminder_status: "sent", reminder_error: null, reminder_sent_at: now }
        : {
          contact_id: contact.id, conversation_id: conv.id, last_status: "sent", last_error: null,
          last_sent_at: now, send_count: (r.send_count || 0) + 1,
        }) as any).eq("id", r.id);
      // Tandai chat sebagai kategori webinar (label WEBINAR di Inbox)
      const { data: existingReg } = await admin.from("webinar_registrations").select("id")
        .eq("webinar_id", r.webinar_id).eq("contact_id", contact.id).limit(1).maybeSingle();
      if (!existingReg) {
        await admin.from("webinar_registrations").insert({
          webinar_id: r.webinar_id, contact_id: contact.id, conversation_id: conv.id,
          code_used: "BLAST", message_sent: body,
        });
      }
      await admin.from("whatsapp_gateway_logs").insert({
        direction: "OUTBOUND", level: "info", event: isReminder ? "webinar_reminder" : "webinar_blast", message_sid: res.sid || null,
        conversation_id: conv.id, to_number: phone, status: "sent",
        payload: { content_sid: contentSid, webinar_id: r.webinar_id, variables: vars },
      });
      sent++;
    }
    return { sent, failed };
  });
