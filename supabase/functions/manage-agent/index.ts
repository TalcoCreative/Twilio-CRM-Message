// Admin-only: create, update, disable, reactivate, reassign, or delete agent users
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const j = (d: any, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const PUBLISHABLE = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return j({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, PUBLISHABLE, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u.user) return j({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: isSuper } = await admin.rpc("has_role", { _user_id: u.user.id, _role: "super_admin" });
    if (!isSuper) return j({ error: "Forbidden — hanya super admin yang bisa mengelola agent" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    function normPhone(v: string): string | null {
      const d = String(v || "").replace(/\D/g, "");
      if (!d) return null;
      if (d.startsWith("0")) return "62" + d.slice(1);
      if (d.startsWith("62")) return d;
      return "62" + d;
    }

    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const full_name = String(body.full_name || "").trim();
      const position = String(body.position || "").trim();
      const phone = normPhone(body.phone || "");
      const role = String(body.role || "agent");
      if (!email || !password || password.length < 6) return j({ error: "Email & password (min 6) wajib" }, 400);

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name },
      });
      if (cErr || !created.user) return j({ error: cErr?.message || "Gagal membuat user" }, 400);

      const uid = created.user.id;
      await admin.from("profiles").upsert({ id: uid, email, full_name, position, phone, is_active: true }, { onConflict: "id" });

      // Always persist the selected role. Some environments don't run the auth trigger
      // that used to add the default agent role, so relying on it leaves accounts unrestricted.
      await admin.from("user_roles").delete().eq("user_id", uid);
      await admin.from("user_roles").insert({ user_id: uid, role });

      await admin.from("activity_logs").insert({
        user_id: u.user.id, action: "create_agent", entity_type: "profile", entity_id: uid,
        metadata: { email, full_name, position, phone, role },
      });
      return j({ ok: true, id: uid });
    }

    if (action === "disable") {
      const target = String(body.user_id || "");
      if (!target) return j({ error: "user_id wajib" }, 400);
      if (target === u.user.id) return j({ error: "Tidak bisa nonaktifkan akun sendiri" }, 400);

      const { data: prof } = await admin.from("profiles").select("email,full_name").eq("id", target).maybeSingle();
      if (!prof) return j({ error: "Agent tidak ditemukan" }, 404);

      // Reassign leads & conversations if requested
      const reassignTo = body.reassign_to ? String(body.reassign_to) : null;
      const reassignPayload: any = { user_id: u.user.id, target_id: target };
      if (reassignTo) {
        if (reassignTo === target) return j({ error: "Tidak bisa reassign ke agent yang sama" }, 400);
        const { data: toProf } = await admin.from("profiles").select("id").eq("id", reassignTo).eq("is_active", true).maybeSingle();
        if (!toProf) return j({ error: "Agent target reassign tidak aktif" }, 400);
        await admin.from("contacts").update({ assigned_agent_id: reassignTo }).eq("assigned_agent_id", target);
        await admin.from("conversations").update({ assigned_agent_id: reassignTo }).eq("assigned_agent_id", target);
        reassignPayload.reassign_to = reassignTo;
      } else {
        await admin.from("contacts").update({ assigned_agent_id: null }).eq("assigned_agent_id", target);
        await admin.from("conversations").update({ assigned_agent_id: null }).eq("assigned_agent_id", target);
      }

      // Disable profile and revoke all sessions
      await admin.from("profiles").update({ is_active: false }).eq("id", target);
      try {
        await admin.auth.admin.signOut(target);
      } catch (e) {
        // Ignore sign-out errors; profile is already disabled so login is blocked on the client anyway.
        console.log("signOut target failed", e);
      }

      await admin.from("activity_logs").insert({
        user_id: u.user.id, action: "disable_agent", entity_type: "profile", entity_id: target,
        metadata: { email: prof.email, full_name: prof.full_name, reassign_to: reassignTo || null },
      });
      return j({ ok: true });
    }

    if (action === "reactivate") {
      const target = String(body.user_id || "");
      if (!target) return j({ error: "user_id wajib" }, 400);
      const { data: prof } = await admin.from("profiles").select("email,full_name").eq("id", target).maybeSingle();
      await admin.from("profiles").update({ is_active: true }).eq("id", target);
      await admin.from("activity_logs").insert({
        user_id: u.user.id, action: "reactivate_agent", entity_type: "profile", entity_id: target,
        metadata: { email: prof?.email, full_name: prof?.full_name },
      });
      return j({ ok: true });
    }

    if (action === "reassign") {
      const from = String(body.from_user_id || "");
      const to = String(body.to_user_id || "");
      if (!from || !to) return j({ error: "from_user_id dan to_user_id wajib" }, 400);
      if (from === to) return j({ error: "Tidak bisa reassign ke agent yang sama" }, 400);
      const { data: toProf } = await admin.from("profiles").select("id").eq("id", to).eq("is_active", true).maybeSingle();
      if (!toProf) return j({ error: "Agent target tidak aktif" }, 400);

      const { data: contactsMoved } = await admin.from("contacts").update({ assigned_agent_id: to }).eq("assigned_agent_id", from).select("id");
      const { data: convsMoved } = await admin.from("conversations").update({ assigned_agent_id: to }).eq("assigned_agent_id", from).select("id");
      await admin.from("activity_logs").insert({
        user_id: u.user.id, action: "reassign_agent_data", entity_type: "profile", entity_id: from,
        metadata: { to_user_id: to, contacts_count: (contactsMoved || []).length, conversations_count: (convsMoved || []).length },
      });
      return j({ ok: true, contacts_count: (contactsMoved || []).length, conversations_count: (convsMoved || []).length });
    }

    if (action === "delete") {
      const target = String(body.user_id || "");
      if (!target) return j({ error: "user_id wajib" }, 400);
      if (target === u.user.id) return j({ error: "Tidak bisa hapus akun sendiri" }, 400);
      const { data: prof } = await admin.from("profiles").select("email,full_name").eq("id", target).maybeSingle();
      const { error: dErr } = await admin.auth.admin.deleteUser(target);
      if (dErr) return j({ error: dErr.message }, 400);
      await admin.from("activity_logs").insert({
        user_id: u.user.id, action: "delete_agent", entity_type: "profile", entity_id: target,
        metadata: { email: prof?.email, full_name: prof?.full_name },
      });
      return j({ ok: true });
    }

    if (action === "reset_password") {
      const target = String(body.user_id || "");
      const password = String(body.password || "");
      if (!target || password.length < 6) return j({ error: "user_id & password (min 6) wajib" }, 400);
      const { error } = await admin.auth.admin.updateUserById(target, { password });
      if (error) return j({ error: error.message }, 400);
      await admin.from("activity_logs").insert({
        user_id: u.user.id, action: "reset_password", entity_type: "profile", entity_id: target,
      });
      return j({ ok: true });
    }

    if (action === "update") {
      const target = String(body.user_id || "");
      if (!target) return j({ error: "user_id wajib" }, 400);
      const patch: Record<string, any> = {};
      if (typeof body.full_name === "string") patch.full_name = body.full_name.trim();
      if (typeof body.position === "string") patch.position = body.position.trim();
      if (typeof body.phone === "string") patch.phone = normPhone(body.phone);
      if (Object.keys(patch).length) await admin.from("profiles").update(patch).eq("id", target);
      if (typeof body.role === "string" && body.role) {
        await admin.from("user_roles").delete().eq("user_id", target);
        await admin.from("user_roles").insert({ user_id: target, role: body.role });
      }
      return j({ ok: true });
    }

    return j({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("manage-agent fatal", e);
    return j({ error: String(e) }, 500);
  }
});
