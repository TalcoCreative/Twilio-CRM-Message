// One-off backfill: re-render any messages saved with "[Follow Up] …" fallback
// so they contain the real Twilio Content Template body with variables filled in.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  CORS_HEADERS, jsonResponse, loadTwilioConfig, loadContentSids,
  normalizeContentVars, getEnv, basicAuthHeader,
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
    if (!userRes.user) return jsonResponse({ success: false, error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const cfg = await loadTwilioConfig(admin);
    const sids = await loadContentSids(admin);
    if (!sids.lead_follow_up) {
      return jsonResponse({ success: false, error: "Content SID Lead Follow Up belum dikonfigurasi." }, 400);
    }

    // Fetch template body once
    const url = `https://content.twilio.com/v1/Content/${encodeURIComponent(sids.lead_follow_up)}`;
    const tryFetch = (auth: string) => fetch(url, { headers: { Authorization: auth } });
    let cRes = await tryFetch(basicAuthHeader(cfg));
    if (!cRes.ok && cfg.accountSid && cfg.authToken) {
      cRes = await tryFetch("Basic " + btoa(`${cfg.accountSid}:${cfg.authToken}`));
    }
    const cJson: any = await cRes.json().catch(() => ({}));
    const types = cJson?.types || {};
    const templateBody: string =
      types["twilio/text"]?.body ||
      types["twilio/media"]?.body ||
      types["twilio/quick-reply"]?.body ||
      types["twilio/call-to-action"]?.body ||
      types["twilio/card"]?.body ||
      types["twilio/list-picker"]?.body || "";
    if (!templateBody) {
      return jsonResponse({ success: false, error: `Template body kosong (status=${cRes.status}).`, raw: cJson }, 502);
    }

    // Find stale rows
    const { data: rows, error: qErr } = await admin
      .from("messages")
      .select("id, conversation_id, content")
      .like("content", "[Follow Up]%");
    if (qErr) return jsonResponse({ success: false, error: qErr.message }, 500);

    const updated: Array<{ id: string; content: string }> = [];
    for (const row of rows || []) {
      const { data: conv } = await admin.from("conversations")
        .select("id, last_message_preview, contact:contacts(full_name, product:products!contacts_interested_product_id_fkey(name))")
        .eq("id", row.conversation_id).maybeSingle();
      const c: any = conv?.contact || {};
      const vars = normalizeContentVars({
        "1": c.full_name || "",
        "2": c.product?.name || "",
      });
      const rendered = templateBody.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, k) => vars[String(k)] ?? "");
      await admin.from("messages").update({ content: rendered }).eq("id", row.id);
      // Refresh conversation preview when it still shows old fallback
      if (conv && typeof conv.last_message_preview === "string" && conv.last_message_preview.startsWith("[Follow Up]")) {
        await admin.from("conversations").update({ last_message_preview: rendered.slice(0, 160) }).eq("id", conv.id);
      }
      updated.push({ id: row.id, content: rendered });
    }

    return jsonResponse({ success: true, count: updated.length, template_body: templateBody, updated });
  } catch (e) {
    return jsonResponse({ success: false, error: String(e) }, 500);
  }
});
