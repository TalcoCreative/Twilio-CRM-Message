// Notify agent via WhatsApp using Twilio Content Templates for business-initiated messages.
// Modes:
//   - assignment  → Agent Assignment template
//   - invitation  → Lead Invitation template
//   - test        → freeform (internal debug only, not customer-facing)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  CORS_HEADERS, jsonResponse, loadTwilioConfig, twilioSendMessage,
  twilioSendContentTemplate, loadContentSids, normalizeContentVars,
  getEnv, validateConfig,
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
    const assigner = userRes.user;
    if (!assigner) return jsonResponse({ success: false, error: "Unauthorized" }, 401);

    const body = await req.json();
    const { conversation_id, agent_id, test, message: customMessage, mode, invitation_id } = body;
    if (!agent_id) return jsonResponse({ success: false, error: "agent_id required" }, 400);
    if (!test && !conversation_id) return jsonResponse({ success: false, error: "conversation_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    if (!test && agent_id === assigner.id) return jsonResponse({ success: true, ok: true, skipped: "self-assign" });

    const [{ data: agent }, { data: assignerProf }] = await Promise.all([
      admin.from("profiles").select("id, full_name, email, phone").eq("id", agent_id).maybeSingle(),
      admin.from("profiles").select("full_name, email").eq("id", assigner.id).maybeSingle(),
    ]);
    if (!agent?.phone) return jsonResponse({ success: true, ok: false, skipped: "agent has no phone" });

    const cfg = await loadTwilioConfig(admin);
    const cfgErr = validateConfig(cfg, { requireFrom: true });
    if (cfgErr) return jsonResponse({ success: false, ok: false, skipped: "twilio not configured", error: cfgErr });

    // ------- Test mode → freeform (internal debug only) -------
    if (test) {
      const message = (customMessage && String(customMessage).trim())
        || `Hi ${agent.full_name || "Agent"}, ini pesan test dari CRM Husada.`;
      const send = await twilioSendMessage(cfg, { to: agent.phone, body: message });
      await admin.from("whatsapp_gateway_logs").insert({
        direction: "OUTBOUND", level: send.ok ? "info" : "error",
        event: "notify_test",
        message_sid: send.sid || null, to_number: agent.phone,
        status: send.ok ? "sent" : String(send.status || ""),
        error_code: send.errorCode ? String(send.errorCode) : null,
        error_message: send.errorMessage || null,
        payload: send.raw as any,
      });
      return jsonResponse({
        success: send.ok, ok: send.ok, sid: send.sid,
        twilio_code: send.errorCode || null, twilio_message: send.errorMessage || null,
      });
    }

    // ------- Business-initiated → Content Template -------
    const sids = await loadContentSids(admin);
    const templateMode = mode === "invitation" ? "invitation" : "assignment";
    const contentSid = templateMode === "invitation" ? sids.lead_invitation : sids.agent_assignment;
    if (!contentSid) {
      const label = templateMode === "invitation" ? "Lead Invitation" : "Agent Assignment";
      const msg = `Content SID untuk "${label}" belum dikonfigurasi pada WhatsApp Gateway.`;
      await admin.from("whatsapp_gateway_logs").insert({
        direction: "OUTBOUND", level: "error", event: `notify_${templateMode}`,
        conversation_id: conversation_id || null, to_number: agent.phone,
        status: "config_missing", error_message: msg,
      });
      return jsonResponse({ success: false, ok: false, error: msg });
    }

    const { data: conv } = await admin.from("conversations")
      .select("id, contact:contacts(full_name, whatsapp_number, chief_complaint, interested_product_id, product:products!contacts_interested_product_id_fkey(name))")
      .eq("id", conversation_id).maybeSingle();
    const c: any = conv?.contact || {};
    const assignerName = assignerProf?.full_name || assignerProf?.email?.split("@")[0] || "Admin";

    // Twilio Content Variables — numeric keys matching template placeholders {{1}}..{{6}}
    const contentVariables = normalizeContentVars({
      "1": agent.full_name || agent.email || "Agent",
      "2": assignerName,
      "3": c.full_name || "",
      "4": c.whatsapp_number || "",
      "5": c.product?.name || "",
      "6": c.chief_complaint || "",
    });

    const send = await twilioSendContentTemplate(cfg, {
      to: agent.phone, contentSid, contentVariables,
    });

    await admin.from("whatsapp_gateway_logs").insert({
      direction: "OUTBOUND", level: send.ok ? "info" : "error",
      event: `notify_${templateMode}`,
      message_sid: send.sid || null,
      conversation_id: conversation_id || null,
      to_number: agent.phone,
      status: send.ok ? "sent" : String(send.status || ""),
      error_code: send.errorCode ? String(send.errorCode) : null,
      error_message: send.errorMessage || null,
      payload: { content_sid: contentSid, variables: contentVariables, invitation_id: invitation_id || null, raw: send.raw } as any,
    });

    return jsonResponse({
      success: send.ok, ok: send.ok,
      twilio_code: send.errorCode || null,
      twilio_message: send.errorMessage || null,
      sid: send.sid,
      content_sid: contentSid,
    });
  } catch (e) {
    console.error("[notify-agent-assign] fatal", e);
    return jsonResponse({ success: false, error: String(e) }, 500);
  }
});
