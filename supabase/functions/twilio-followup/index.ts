// Send WhatsApp Lead Follow Up template when the customer service window (>24h) is closed.
// Uses Twilio Content Template configured in Settings → WhatsApp Gateway.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  CORS_HEADERS, jsonResponse, loadTwilioConfig, twilioSendContentTemplate,
  loadContentSids, normalizeContentVars, getEnv, validateConfig, basicAuthHeader,
} from "../_shared/twilio.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  const SUPABASE_URL = getEnv("SUPABASE_URL")!;
  const SERVICE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY")!;
  const PUBLISHABLE = getEnv("SUPABASE_PUBLISHABLE_KEY") || getEnv("SUPABASE_ANON_KEY")!;

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return jsonResponse({ success: false, error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, PUBLISHABLE, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes.user;
    if (!user) return jsonResponse({ success: false, error: "Unauthorized" }, 401);

    const body = await req.json();
    const { conversation_id } = body as { conversation_id?: string };
    if (!conversation_id) return jsonResponse({ success: false, error: "conversation_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const cfg = await loadTwilioConfig(admin);
    const cfgErr = validateConfig(cfg, { requireFrom: true });
    if (cfgErr) return jsonResponse({ success: false, error: cfgErr }, 500);

    const sids = await loadContentSids(admin);
    if (!sids.lead_follow_up) {
      const msg = `Content SID untuk "Lead Follow Up" belum dikonfigurasi pada WhatsApp Gateway.`;
      await admin.from("whatsapp_gateway_logs").insert({
        direction: "OUTBOUND", level: "error", event: "followup",
        conversation_id, status: "config_missing", error_message: msg,
      });
      return jsonResponse({ success: false, error: msg }, 400);
    }

    const { data: conv } = await admin.from("conversations")
      .select("id, contact:contacts(full_name, whatsapp_number, interested_product_id, product:products!contacts_interested_product_id_fkey(name))")
      .eq("id", conversation_id).maybeSingle();
    if (!conv) return jsonResponse({ success: false, error: "Conversation not found" }, 404);
    const c: any = conv.contact || {};
    const toNumber = c.whatsapp_number;
    if (!toNumber) return jsonResponse({ success: false, error: "Kontak tidak memiliki nomor WhatsApp" }, 400);

    const contentVariables = normalizeContentVars({
      "1": c.full_name || "",
      "2": c.product?.name || "",
    });

    const send = await twilioSendContentTemplate(cfg, {
      to: toNumber, contentSid: sids.lead_follow_up, contentVariables,
    });

    if (!send.ok) {
      await admin.from("whatsapp_gateway_logs").insert({
        direction: "OUTBOUND", level: "error", event: "followup",
        conversation_id, to_number: toNumber,
        status: String(send.status || ""),
        error_code: send.errorCode ? String(send.errorCode) : null,
        error_message: send.errorMessage || null,
        payload: { content_sid: sids.lead_follow_up, variables: contentVariables, raw: send.raw } as any,
      });
      return jsonResponse({
        success: false, ok: false, twilio_code: send.errorCode,
        twilio_message: send.errorMessage, error: send.errorMessage, raw: send.raw,
      }, send.status && send.status >= 400 ? send.status : 502);
    }

    // Fetch template body from Twilio Content API so we can persist the real message text
    let renderedBody = "";
    try {
      const cRes = await fetch(`https://content.twilio.com/v1/Content/${encodeURIComponent(sids.lead_follow_up)}`, {
        headers: { Authorization: basicAuthHeader(cfg) },
      });
      const cJson: any = await cRes.json().catch(() => ({}));
      const types = cJson?.types || {};
      const body: string =
        types["twilio/text"]?.body ||
        types["twilio/media"]?.body ||
        types["twilio/quick-reply"]?.body ||
        types["twilio/call-to-action"]?.body ||
        types["twilio/card"]?.body ||
        types["twilio/list-picker"]?.body ||
        "";
      renderedBody = String(body || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, k) => contentVariables[String(k)] ?? "");
    } catch (e) {
      console.warn("[twilio-followup] fetch content template failed", e);
    }
    if (!renderedBody) renderedBody = `[Follow Up] ${c.full_name || ""}`.trim();

    // Persist message + update conversation preview
    const { data: msg, error: insErr } = await admin.from("messages").insert({
      conversation_id, direction: "OUTBOUND", type: "TEMPLATE" as any,
      content: renderedBody,
      sent_by_id: user.id,
      fonnte_message_id: send.sid || null,
      status: "SENT",
    } as any).select().single();

    await admin.from("whatsapp_gateway_logs").insert({
      direction: "OUTBOUND", level: "info", event: "followup",
      message_sid: send.sid || null, conversation_id, to_number: toNumber,
      status: "sent",
      payload: { content_sid: sids.lead_follow_up, variables: contentVariables, body: renderedBody } as any,
    });

    await admin.from("conversations").update({
      last_message_at: new Date().toISOString(),
      last_message_preview: renderedBody.slice(0, 160),
      last_replied_by_id: user.id,
    }).eq("id", conversation_id);

    return jsonResponse({
      success: true, ok: true, sid: send.sid,
      content_sid: sids.lead_follow_up, message: msg, insert_error: insErr?.message || null,
    });
  } catch (e) {
    console.error("[twilio-followup] fatal", e);
    return jsonResponse({ success: false, error: String(e) }, 500);
  }
});
