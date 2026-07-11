// Twilio Programmable Messaging — outbound sender.
// Called by CRM UI to send text or media WhatsApp messages.
import {
  CORS_HEADERS, jsonResponse, loadTwilioConfig, makeAdmin,
  twilioSendMessage, validateConfig, getEnv,
} from "../_shared/twilio.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type MsgType = "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO" | "VOICE" | "STICKER";
function detectMediaType(url: string): MsgType {
  const e = (url.split("?")[0].split(".").pop() || "").toLowerCase();
  if (e === "webp") return "STICKER";
  if (/^(jpg|jpeg|png|gif|bmp)$/.test(e)) return "IMAGE";
  if (/^(ogg|opus)$/.test(e)) return "VOICE";
  if (/^(mp3|wav|m4a|aac)$/.test(e)) return "AUDIO";
  if (/^(mp4|mov|3gp|webm)$/.test(e)) return "VIDEO";
  return "DOCUMENT";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return jsonResponse({ success: false, error: "Unauthorized" }, 401);

    const SUPABASE_URL = getEnv("SUPABASE_URL")!;
    const PUBLISHABLE = getEnv("SUPABASE_PUBLISHABLE_KEY") || getEnv("SUPABASE_ANON_KEY")!;
    const userClient = createClient(SUPABASE_URL, PUBLISHABLE, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes.user;
    if (!user) return jsonResponse({ success: false, error: "Unauthorized" }, 401);

    const admin = makeAdmin();
    const cfg = await loadTwilioConfig(admin);
    const cfgErr = validateConfig(cfg, { requireFrom: true });
    if (cfgErr) return jsonResponse({ success: false, error: cfgErr }, 500);

    const body = await req.json();
    const {
      conversation_id, content, target, is_test,
      media_path, media_filename, message_type,
    } = body as {
      conversation_id?: string; content?: string; target?: string; is_test?: boolean;
      media_path?: string; media_filename?: string; message_type?: MsgType;
    };
    if (!content && !media_path) {
      return jsonResponse({ success: false, error: "content or attachment required" }, 400);
    }

    let toNumber = target;
    let convId = conversation_id;

    if (!is_test) {
      if (!convId) return jsonResponse({ success: false, error: "conversation_id required" }, 400);
      const { data: conv } = await admin.from("conversations")
        .select("id, contact:contacts(whatsapp_number)")
        .eq("id", convId).single();
      if (!conv) return jsonResponse({ success: false, error: "Conversation not found" }, 404);
      // @ts-ignore
      toNumber = conv.contact?.whatsapp_number;
    }
    if (!toNumber) return jsonResponse({ success: false, error: "target number required" }, 400);

    // Signed URL for attachment (Twilio needs a publicly reachable URL)
    let mediaUrl: string | null = null;
    if (media_path) {
      const { data: signed, error: signErr } = await admin.storage
        .from("chat-media").createSignedUrl(media_path, 60 * 60 * 24 * 7);
      if (signErr || !signed) {
        return jsonResponse({ success: false, error: "Gagal membuat URL attachment: " + (signErr?.message || "") }, 500);
      }
      mediaUrl = signed.signedUrl;
    }

    const wireBody = content?.trim() ? content : (mediaUrl ? (media_filename || "") : "");
    const send = await twilioSendMessage(cfg, {
      to: toNumber, body: wireBody || undefined, mediaUrl: mediaUrl || undefined,
    });

    if (!send.ok) {
      await admin.from("whatsapp_gateway_logs").insert({
        direction: "OUTBOUND", level: "error", event: "send",
        conversation_id: convId || null, to_number: toNumber || null,
        status: String(send.status || ""),
        error_code: send.errorCode ? String(send.errorCode) : null,
        error_message: send.errorMessage || null,
        payload: send.raw as any,
      });
      return jsonResponse({
        success: false,
        status: send.status,
        twilio_code: send.errorCode,
        twilio_message: send.errorMessage,
        error: send.errorMessage,
        raw: send.raw,
      }, send.status && send.status >= 400 ? send.status : 502);
    }

    if (is_test) {
      await admin.from("whatsapp_gateway_logs").insert({
        direction: "OUTBOUND", level: "info", event: "send_test",
        message_sid: send.sid || null, to_number: toNumber || null, status: "sent",
      });
      return jsonResponse({ success: true, ok: true, sid: send.sid, twilio: send.raw });
    }

    const messageSid = send.sid || null;

    const { data: lastIn } = await admin.from("messages").select("sent_at")
      .eq("conversation_id", convId).eq("direction", "INBOUND")
      .order("sent_at", { ascending: false }).limit(1).maybeSingle();
    const respSec = lastIn?.sent_at
      ? Math.max(0, Math.floor((Date.now() - new Date(lastIn.sent_at).getTime()) / 1000))
      : null;

    const msgType = message_type || (mediaUrl ? detectMediaType(media_path || "") : "TEXT");
    const { data: msg, error: insErr } = await admin.from("messages").insert({
      conversation_id: convId, direction: "OUTBOUND", type: msgType,
      content: content || (media_filename || "(attachment)"),
      sent_by_id: user.id,
      fonnte_message_id: messageSid,          // schema column reused for MessageSid
      status: "SENT", response_seconds: respSec,
      media_url: mediaUrl,
    }).select().single();
    if (insErr) return jsonResponse({ success: false, error: insErr.message }, 500);

    await admin.from("whatsapp_gateway_logs").insert({
      direction: "OUTBOUND", level: "info", event: "send",
      message_sid: messageSid, conversation_id: convId || null,
      to_number: toNumber || null, status: "sent",
    });

    const { data: conv2 } = await admin.from("conversations")
      .select("first_response_at").eq("id", convId).maybeSingle();
    const convPatch: any = {
      last_message_at: new Date().toISOString(),
      last_message_preview: (content || media_filename || "(attachment)").slice(0, 100),
      last_replied_by_id: user.id,
    };
    if (!conv2?.first_response_at) convPatch.first_response_at = new Date().toISOString();
    await admin.from("conversations").update(convPatch).eq("id", convId);

    return jsonResponse({ success: true, ok: true, message: msg, sid: send.sid });
  } catch (e) {
    console.error("[twilio-send] fatal", e);
    return jsonResponse({ success: false, error: String(e) }, 500);
  }
});
