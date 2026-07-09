// Notify agent via WhatsApp (Twilio) on assignment/invitation, or send a test.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  CORS_HEADERS, jsonResponse, loadTwilioConfig, twilioSendMessage, getEnv, validateConfig,
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

    let message: string;
    if (test) {
      message = customMessage?.trim() ||
        `Hi ${agent.full_name || "Agent"}, ini pesan test penugasan dari CRM Husada. Jika kamu menerima pesan ini, berarti nomor WhatsApp kamu sudah terhubung dengan benar.`;
    } else {
      const { data: conv } = await admin.from("conversations")
        .select("id, contact:contacts(full_name, whatsapp_number, chief_complaint, interested_product_id, product:products!contacts_interested_product_id_fkey(name))")
        .eq("id", conversation_id).maybeSingle();
      const c: any = conv?.contact || {};
      const productName = c.product?.name || "—";
      const assignerName = assignerProf?.full_name || assignerProf?.email?.split("@")[0] || "Admin";
      if (mode === "invitation") {
        message =
          `Hi ${agent.full_name || "Agent"}, kamu dapet *INVITATION* penugasan lead dari *${assignerName}* (First Response) di CRM Husada.\n\n` +
          `Nama Lead   : ${c.full_name || "—"}\n` +
          `WhatsApp    : ${c.whatsapp_number || "—"}\n` +
          `Produk      : ${productName}\n` +
          `Keluhan     : ${c.chief_complaint || "—"}\n\n` +
          `Kamu diundang untuk mengambil alih lead ini. Bisa TERIMA untuk ambil alih, atau TOLAK jika belum layak follow-up.\n\n` +
          `Buka: /invitation/${invitation_id || ""}`;
      } else {
        message =
          `Hi ${agent.full_name || "Agent"}, kamu ditugaskan oleh ${assignerName} untuk menjawab lead di Inbox CRM Husada.\n\n` +
          `Nama Lead   : ${c.full_name || "—"}\n` +
          `WhatsApp    : ${c.whatsapp_number || "—"}\n` +
          `Produk      : ${productName}\n` +
          `Keluhan     : ${c.chief_complaint || "—"}\n\n` +
          `Mohon segera ditindaklanjuti.`;
      }
    }

    const send = await twilioSendMessage(cfg, { to: agent.phone, body: message });
    return jsonResponse({
      success: send.ok, ok: send.ok,
      twilio_code: send.errorCode || null,
      twilio_message: send.errorMessage || null,
      sid: send.sid,
    });
  } catch (e) {
    console.error("[notify-agent-assign] fatal", e);
    return jsonResponse({ success: false, error: String(e) }, 500);
  }
});
