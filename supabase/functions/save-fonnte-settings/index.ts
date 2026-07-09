// Save Twilio settings (admin only). Validates SID+Token and stores From number.
// Kept at path "save-fonnte-settings" for frontend backward-compat.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const j = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const PUBLISHABLE = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return j({ error: "Unauthorized (no token)" }, 401);

    const userClient = createClient(SUPABASE_URL, PUBLISHABLE, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u.user) return j({ error: "Unauthorized (invalid session)" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: isAdmin, error: roleErr } = await admin.rpc("is_admin", { _user_id: u.user.id });
    if (roleErr) return j({ error: "Role check failed: " + roleErr.message }, 500);
    if (!isAdmin) return j({ error: "Forbidden — admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const account_sid = typeof body.account_sid === "string" ? body.account_sid.trim() : "";
    const auth_token = typeof body.auth_token === "string" ? body.auth_token.trim() : "";
    const whatsapp_from = typeof body.whatsapp_from === "string" ? body.whatsapp_from.trim() : "";

    // Disconnect: all fields empty removes stored settings
    if (!account_sid && !auth_token && !whatsapp_from) {
      await admin.from("system_settings").delete().in("key", [
        "twilio_account_sid", "twilio_auth_token", "twilio_whatsapp_from",
        // clean up legacy Fonnte keys if they linger
        "fonnte_api_key", "fonnte_device",
      ]);
      return j({ ok: true, disconnected: true });
    }

    let validateOk = false; let validateData: any = null;
    if (account_sid && auth_token) {
      try {
        const basic = btoa(`${account_sid}:${auth_token}`);
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(account_sid)}.json`, {
          headers: { Authorization: `Basic ${basic}` },
        });
        validateData = await r.json().catch(() => ({}));
        validateOk = r.ok && !validateData?.code;
      } catch (e) {
        console.error("twilio validate fail", e);
      }
    }

    const now = new Date().toISOString();
    const rows: { key: string; value: string }[] = [];
    if (account_sid) rows.push({ key: "twilio_account_sid", value: account_sid });
    if (auth_token) rows.push({ key: "twilio_auth_token", value: auth_token });
    if (whatsapp_from) rows.push({ key: "twilio_whatsapp_from", value: whatsapp_from });
    // Mirror device number for legacy inbox label
    if (whatsapp_from) rows.push({ key: "fonnte_device", value: whatsapp_from });

    for (const r of rows) {
      const { error } = await admin
        .from("system_settings")
        .upsert({ key: r.key, value: r.value, updated_by: u.user.id, updated_at: now }, { onConflict: "key" });
      if (error) return j({ error: `Save ${r.key} failed: ${error.message}` }, 500);
    }

    return j({ ok: true, validate_ok: validateOk, validate: validateData });
  } catch (e) {
    console.error("save-twilio-settings fatal", e);
    return j({ error: String(e) }, 500);
  }
});
