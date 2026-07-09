// One-off bootstrap: create the initial super admin account (vina@husada.com).
// Idempotent — if the user already exists, just ensures the super_admin role is set.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const TARGET_EMAIL = "vina@husada.com";
const TARGET_PASSWORD = "123456";
const TARGET_FULL_NAME = "Vina";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const j = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    let userId: string | null = null;

    // Look up existing user by paging through admin.listUsers
    let page = 1;
    while (true) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return j({ error: error.message }, 500);
      const found = data.users.find((u) => (u.email || "").toLowerCase() === TARGET_EMAIL);
      if (found) { userId = found.id; break; }
      if (data.users.length < 200) break;
      page++;
    }

    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email: TARGET_EMAIL,
        password: TARGET_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: TARGET_FULL_NAME },
      });
      if (error || !data.user) return j({ error: error?.message || "createUser failed" }, 500);
      userId = data.user.id;
    } else {
      // Ensure password matches the requested one
      const { error } = await admin.auth.admin.updateUserById(userId, { password: TARGET_PASSWORD, email_confirm: true });
      if (error) return j({ error: error.message }, 500);
    }

    await admin.from("profiles").upsert(
      { id: userId, email: TARGET_EMAIL, full_name: TARGET_FULL_NAME },
      { onConflict: "id" },
    );

    // Force super_admin role only
    await admin.from("user_roles").delete().eq("user_id", userId);
    const { error: roleErr } = await admin.from("user_roles").insert({ user_id: userId, role: "super_admin" });
    if (roleErr) return j({ error: "role insert failed: " + roleErr.message }, 500);

    return j({ ok: true, user_id: userId, email: TARGET_EMAIL });
  } catch (e) {
    return j({ error: String(e) }, 500);
  }
});
