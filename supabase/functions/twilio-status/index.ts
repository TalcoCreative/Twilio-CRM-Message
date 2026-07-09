// Twilio Programmable Messaging — dedicated delivery status callback.
// Endpoint: POST /functions/v1/twilio-status
import {
  CORS_HEADERS, jsonResponse, loadTwilioConfig, makeAdmin, getEnv, buildTwilioSignatureUrls, validateTwilioSignature,
} from "../_shared/twilio.ts";

const STATUS_MAP: Record<string, string> = {
  queued: "SENT", accepted: "SENT", scheduled: "SENT",
  sending: "SENT", sent: "SENT",
  delivered: "DELIVERED", read: "DELIVERED",
  failed: "FAILED", undelivered: "FAILED",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method === "GET") return new Response("Twilio status callback ready", { headers: CORS_HEADERS });

  const admin = makeAdmin();
  try {
    const ct = req.headers.get("content-type") || "";
    const payload: Record<string, string> = {};
    if (ct.includes("application/json")) {
      const j = await req.json();
      Object.keys(j || {}).forEach((k) => { payload[k] = String(j[k] ?? ""); });
    } else {
      const fd = await req.formData();
      for (const [k, v] of fd.entries()) payload[k] = typeof v === "string" ? v : "";
    }

    // Signature validation (tolerate proxy URL rewrites)
    const cfg = await loadTwilioConfig(admin);
    const signature = req.headers.get("x-twilio-signature") || "";
    const skipVerify = (getEnv("TWILIO_SKIP_SIGNATURE") || "").toLowerCase() === "true";
    if (cfg.authToken && signature && !skipVerify) {
      const candidates = buildTwilioSignatureUrls(req, "twilio-status");
      let valid = false;
      for (const url of candidates) {
        if (await validateTwilioSignature({ authToken: cfg.authToken, url, params: payload, signature })) {
          valid = true; break;
        }
      }
      if (!valid) {
        console.warn("[twilio-status] invalid signature", { tried: candidates });
        return jsonResponse({ success: false, error: "Invalid Twilio signature" }, 403);
      }
    }

    const messageSid = String(payload.MessageSid || payload.SmsSid || "");
    const messageStatus = String(payload.MessageStatus || payload.SmsStatus || "").toLowerCase();
    const errorCode = payload.ErrorCode || null;
    const errorMessage = payload.ErrorMessage || null;

    console.log(`[twilio-status] sid=${messageSid} status=${messageStatus} errorCode=${errorCode || "-"}`);

    if (!messageSid || !messageStatus) {
      return jsonResponse({ success: false, error: "MessageSid and MessageStatus required" }, 400);
    }
    const mapped = STATUS_MAP[messageStatus];
    if (mapped) {
      await admin.from("messages").update({ status: mapped })
        .eq("fonnte_message_id", messageSid);
    }
    return jsonResponse({
      success: true, status: messageStatus, mapped,
      twilio_code: errorCode, twilio_message: errorMessage,
    });
  } catch (e) {
    console.error("[twilio-status] fatal", e);
    return jsonResponse({ success: false, error: String(e) }, 500);
  }
});
