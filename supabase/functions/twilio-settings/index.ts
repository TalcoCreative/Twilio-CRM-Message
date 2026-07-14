// Admin-only endpoint: save Twilio settings from the UI form.
// Validates credentials before persisting. Env vars (if set) still take
// precedence at runtime — this is a fallback for UI-only config.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { CORS_HEADERS, jsonResponse, getEnv } from "../_shared/twilio.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  try {
    const SUPABASE_URL = getEnv("SUPABASE_URL")!;
    const SERVICE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY")!;
    const PUBLISHABLE = getEnv("SUPABASE_PUBLISHABLE_KEY") || getEnv("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return jsonResponse({ success: false, error: "Unauthorized (no token)" }, 401);

    const userClient = createClient(SUPABASE_URL, PUBLISHABLE, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u.user) return jsonResponse({ success: false, error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: isAdmin, error: roleErr } = await admin.rpc("is_admin", { _user_id: u.user.id });
    if (roleErr) return jsonResponse({ success: false, error: "Role check failed: " + roleErr.message }, 500);
    if (!isAdmin) return jsonResponse({ success: false, error: "Forbidden — admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const account_sid = String(body.account_sid || "").trim();
    const auth_token = String(body.auth_token || "").trim();
    const whatsapp_from = String(body.whatsapp_from || "").trim();
    const messaging_service_sid = String(body.messaging_service_sid || "").trim();
    const api_key_sid = String(body.api_key_sid || "").trim();
    const api_key_secret = String(body.api_key_secret || "").trim();

    // Content SIDs for outbound templates (optional; only touched when key exists in body)
    const contentSidKeys: Record<string, string> = {
      content_sid_agent_assignment: "twilio_content_sid_agent_assignment",
      content_sid_lead_invitation: "twilio_content_sid_lead_invitation",
      content_sid_lead_follow_up: "twilio_content_sid_lead_follow_up",
    };

    // Disconnect: all credentials empty AND no content sid fields → wipe settings
    const contentTouched = Object.keys(contentSidKeys).some((k) => k in body);
    if (!account_sid && !auth_token && !whatsapp_from && !messaging_service_sid && !api_key_sid && !api_key_secret && !contentTouched) {
      await admin.from("system_settings").delete().in("key", [
        "twilio_account_sid", "twilio_auth_token", "twilio_whatsapp_from",
        "twilio_messaging_service_sid", "twilio_api_key_sid", "twilio_api_key_secret",
        "fonnte_api_key", "fonnte_device",
      ]);
      return jsonResponse({ success: true, ok: true, disconnected: true });
    }

    // Validate against Twilio if we have SID + (Auth Token or API Key pair)
    let validateOk = false; let validateData: any = null;
    const basic = (api_key_sid && api_key_secret)
      ? "Basic " + btoa(`${api_key_sid}:${api_key_secret}`)
      : (account_sid && auth_token ? "Basic " + btoa(`${account_sid}:${auth_token}`) : null);
    if (account_sid && basic) {
      try {
        const r = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(account_sid)}.json`,
          { headers: { Authorization: basic } },
        );
        validateData = await r.json().catch(() => ({}));
        validateOk = r.ok && !validateData?.code;
      } catch (e) {
        console.error("[twilio-settings] validate err", e);
      }
    }

    const now = new Date().toISOString();
    const rows: { key: string; value: string }[] = [];
    if (account_sid) rows.push({ key: "twilio_account_sid", value: account_sid });
    if (auth_token) rows.push({ key: "twilio_auth_token", value: auth_token });
    if (whatsapp_from) rows.push({ key: "twilio_whatsapp_from", value: whatsapp_from });
    if (messaging_service_sid) rows.push({ key: "twilio_messaging_service_sid", value: messaging_service_sid });
    if (api_key_sid) rows.push({ key: "twilio_api_key_sid", value: api_key_sid });
    if (api_key_secret) rows.push({ key: "twilio_api_key_secret", value: api_key_secret });
    if (whatsapp_from) rows.push({ key: "fonnte_device", value: whatsapp_from }); // legacy inbox label

    for (const r of rows) {
      const { error } = await admin.from("system_settings")
        .upsert({ key: r.key, value: r.value, updated_by: u.user.id, updated_at: now }, { onConflict: "key" });
      if (error) return jsonResponse({ success: false, error: `Save ${r.key} failed: ${error.message}` }, 500);
    }

    // Handle content SIDs: upsert when non-empty, delete when explicitly empty
    for (const [inKey, dbKey] of Object.entries(contentSidKeys)) {
      if (!(inKey in body)) continue;
      const v = String((body as any)[inKey] || "").trim();
      if (v) {
        const { error } = await admin.from("system_settings")
          .upsert({ key: dbKey, value: v, updated_by: u.user.id, updated_at: now }, { onConflict: "key" });
        if (error) return jsonResponse({ success: false, error: `Save ${dbKey} failed: ${error.message}` }, 500);
      } else {
        await admin.from("system_settings").delete().eq("key", dbKey);
      }
    }

    return jsonResponse({
      success: true, ok: true,
      validate_ok: validateOk,
      twilio_code: validateData?.code || null,
      twilio_message: validateData?.message || null,
      validate: validateData,
    });
  } catch (e) {
    console.error("[twilio-settings] fatal", e);
    return jsonResponse({ success: false, error: String(e) }, 500);
  }
});
