// Test Twilio credential validity by fetching Account resource.
// Kept at path "fonnte-test" for frontend backward-compat.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const j = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const { account_sid, auth_token } = await req.json();
    if (!account_sid || !auth_token) return j({ ok: false, error: "account_sid & auth_token required" }, 400);
    const basic = btoa(`${account_sid}:${auth_token}`);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(account_sid)}.json`, {
      headers: { Authorization: `Basic ${basic}` },
    });
    const text = await res.text();
    let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return j({ ok: res.ok, status: res.status, data });
  } catch (e) {
    return j({ ok: false, error: String(e) }, 500);
  }
});
