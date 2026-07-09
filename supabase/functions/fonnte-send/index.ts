// Send WhatsApp via Twilio and store as OUTBOUND message (text or attachment).
// Kept at path "fonnte-send" for frontend backward-compat.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function detectMediaType(url: string): "IMAGE" | "DOCUMENT" | "AUDIO" {
  const e = (url.split("?")[0].split(".").pop() || "").toLowerCase();
  if (/^(jpg|jpeg|png|gif|webp|bmp)$/.test(e)) return "IMAGE";
  if (/^(mp3|ogg|wav|m4a|opus|aac)$/.test(e)) return "AUDIO";
  return "DOCUMENT";
}

function toWa(num: string): string {
  const raw = String(num || "").trim();
  if (!raw) return "";
  if (raw.startsWith("whatsapp:")) return raw;
  let n = raw.replace(/[^\d+]/g, "");
  if (n.startsWith("+")) return `whatsapp:${n}`;
  if (n.startsWith("0")) n = "62" + n.slice(1);
  if (!n.startsWith("62") && !/^\d{10,15}$/.test(n)) n = "62" + n;
  return `whatsapp:+${n}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const PUBLISHABLE = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;

  const json = (d: any, s = 200) => new Response(JSON.stringify(d), {
    status: s, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, PUBLISHABLE, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json();
    const {
      conversation_id, content, target, is_test,
      media_path, media_filename,
    } = body as {
      conversation_id?: string; content?: string; target?: string; is_test?: boolean;
      media_path?: string; media_filename?: string;
    };

    if (!content && !media_path) return json({ error: "content or attachment required" }, 400);

    const { data: settings } = await admin
      .from("system_settings").select("key,value")
      .in("key", ["twilio_account_sid", "twilio_auth_token", "twilio_whatsapp_from"]);
    const sid = settings?.find((s) => s.key === "twilio_account_sid")?.value;
    const authTok = settings?.find((s) => s.key === "twilio_auth_token")?.value;
    const fromNum = settings?.find((s) => s.key === "twilio_whatsapp_from")?.value;
    if (!sid || !authTok || !fromNum) {
      return json({ error: "Twilio belum dikonfigurasi. Atur di Settings → WhatsApp Gateway." }, 400);
    }

    let toNumber = target;
    let convId = conversation_id;

    if (!is_test) {
      if (!convId) return json({ error: "conversation_id required" }, 400);
      const { data: conv } = await admin
        .from("conversations")
        .select("id, contact:contacts(whatsapp_number)")
        .eq("id", convId).single();
      if (!conv) return json({ error: "Conversation not found" }, 404);
      // @ts-ignore
      toNumber = conv.contact?.whatsapp_number;
    }
    if (!toNumber) return json({ error: "target number required" }, 400);

    // Public signed URL for media (Twilio needs a publicly reachable URL).
    let mediaUrl: string | null = null;
    if (media_path) {
      const { data: signed, error: signErr } = await admin.storage
        .from("chat-media").createSignedUrl(media_path, 60 * 60 * 24 * 7);
      if (signErr || !signed) return json({ error: "Gagal membuat URL attachment: " + (signErr?.message || "") }, 500);
      mediaUrl = signed.signedUrl;
    }

    const wireBody = content && content.trim().length > 0
      ? content
      : (mediaUrl ? (media_filename || "") : "");

    const fd = new URLSearchParams();
    fd.append("From", toWa(fromNum));
    fd.append("To", toWa(toNumber));
    if (wireBody) fd.append("Body", wireBody);
    if (mediaUrl) fd.append("MediaUrl", mediaUrl);

    const basic = btoa(`${sid}:${authTok}`);
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
    const fres = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: fd,
    });
    const fdata = await fres.json().catch(() => ({}));

    if (!fres.ok || fdata?.code) {
      return json({ ok: false, error: fdata?.message || `Twilio ${fres.status}`, twilio: fdata, status: fres.status }, 502);
    }

    if (is_test) return json({ ok: true, twilio: fdata });

    const messageSid = fdata?.sid ? String(fdata.sid) : null;

    const { data: lastIn } = await admin
      .from("messages").select("sent_at")
      .eq("conversation_id", convId).eq("direction", "INBOUND")
      .order("sent_at", { ascending: false }).limit(1).maybeSingle();
    const respSec = lastIn?.sent_at
      ? Math.max(0, Math.floor((Date.now() - new Date(lastIn.sent_at).getTime()) / 1000))
      : null;

    const msgType = mediaUrl ? detectMediaType(media_path || "") : "TEXT";
    const { data: msg, error: insErr } = await admin
      .from("messages").insert({
        conversation_id: convId, direction: "OUTBOUND", type: msgType,
        content: content || (media_filename || "(attachment)"),
        sent_by_id: user.id, fonnte_message_id: messageSid,
        status: "SENT", response_seconds: respSec,
        media_url: mediaUrl,
      }).select().single();
    if (insErr) return json({ error: insErr.message }, 500);

    const { data: conv2 } = await admin.from("conversations").select("first_response_at").eq("id", convId).maybeSingle();
    const convPatch: any = {
      last_message_at: new Date().toISOString(),
      last_message_preview: (content || media_filename || "(attachment)").slice(0, 100),
      last_replied_by_id: user.id,
    };
    if (!conv2?.first_response_at) convPatch.first_response_at = new Date().toISOString();
    await admin.from("conversations").update(convPatch).eq("id", convId);

    return json({ ok: true, message: msg, twilio: fdata });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
