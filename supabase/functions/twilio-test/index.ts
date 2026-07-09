// Twilio credential test — verifies account access via GET /Accounts/{Sid}.json
import { CORS_HEADERS, jsonResponse, getEnv } from "../_shared/twilio.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  try {
    const body = await req.json().catch(() => ({}));
    const account_sid = String(body.account_sid || getEnv("TWILIO_ACCOUNT_SID") || "").trim();
    const auth_token = String(body.auth_token || getEnv("TWILIO_AUTH_TOKEN") || "").trim();
    const api_key_sid = String(body.api_key_sid || getEnv("TWILIO_API_KEY_SID") || "").trim();
    const api_key_secret = String(body.api_key_secret || getEnv("TWILIO_API_KEY_SECRET") || "").trim();

    if (!account_sid) return jsonResponse({ ok: false, success: false, error: "account_sid required" }, 400);

    const basic = (api_key_sid && api_key_secret)
      ? "Basic " + btoa(`${api_key_sid}:${api_key_secret}`)
      : (auth_token ? "Basic " + btoa(`${account_sid}:${auth_token}`) : null);
    if (!basic) return jsonResponse({ ok: false, success: false, error: "auth_token or API Key pair required" }, 400);

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(account_sid)}.json`,
      { headers: { Authorization: basic } },
    );
    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    console.log(`[twilio-test] status=${res.status} code=${data?.code || "-"}`);
    return jsonResponse({
      ok: res.ok && !data?.code,
      success: res.ok && !data?.code,
      status: res.status,
      twilio_code: data?.code || null,
      twilio_message: data?.message || null,
      data,
    });
  } catch (e) {
    console.error("[twilio-test] fatal", e);
    return jsonResponse({ ok: false, success: false, error: String(e) }, 500);
  }
});
