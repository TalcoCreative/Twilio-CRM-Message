// One-shot seeder — creates predefined staff accounts. Delete after use.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Seed = { name: string; phone: string; role: "super_admin" | "agent" | "first_response"; email: string; password: string };

function firstName(full: string) {
  return full.replace(/^dr\s+/i, "").trim().split(/\s+/)[0];
}
function emailFor(full: string) {
  const key = firstName(full).toLowerCase().replace(/[^a-z]/g, "");
  return `${key}@husada.com`;
}
function passFor(full: string) {
  const key = firstName(full);
  return `${key}1@`;
}
function normPhone(v: string) {
  const d = String(v || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("0")) return "62" + d.slice(1);
  if (d.startsWith("62")) return d;
  return "62" + d;
}

const staff: { name: string; phone: string; role: Seed["role"] }[] = [
  { name: "Vina",     phone: "085280950695", role: "super_admin" },
  { name: "Audina",   phone: "087844326313", role: "agent" },
  { name: "Maya",     phone: "082122829703", role: "agent" },
  { name: "Dian",     phone: "082116333339", role: "agent" },
  { name: "Irene",    phone: "087878411812", role: "agent" },
  { name: "dr Candy", phone: "081311582678", role: "agent" },
  { name: "Aura",     phone: "082112415881", role: "agent" },
  { name: "Adel",     phone: "081383346790", role: "first_response" },
  { name: "Rama",     phone: "087840084463", role: "first_response" },
  { name: "Widi",     phone: "085890511020", role: "first_response" },
  { name: "Vivian",   phone: "085883946596", role: "first_response" },
];

const qa: Seed[] = [
  { name: "SuperAdmin QA", email: "SA@husada.com", password: "SA1@husada", role: "super_admin", phone: "" },
  { name: "Agent QA",      email: "A@husada.com",  password: "A1@husada",  role: "agent",       phone: "" },
  { name: "FR QA",         email: "fr@husada.com", password: "fr1@husada", role: "first_response", phone: "" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const seeds: Seed[] = [
      ...staff.map((s) => ({ name: s.name, phone: s.phone, role: s.role, email: emailFor(s.name), password: passFor(s.name) })),
      ...qa,
    ];

    const results: any[] = [];
    for (const s of seeds) {
      const email = s.email.toLowerCase();
      // Check existing
      const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
      let uid = existing?.id as string | undefined;

      if (!uid) {
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email, password: s.password, email_confirm: true,
          user_metadata: { full_name: s.name },
        });
        if (cErr || !created.user) { results.push({ email, error: cErr?.message }); continue; }
        uid = created.user.id;
      } else {
        await admin.auth.admin.updateUserById(uid, { password: s.password, email_confirm: true });
      }

      await admin.from("profiles").upsert(
        { id: uid, email, full_name: s.name, phone: normPhone(s.phone) },
        { onConflict: "id" },
      );
      await admin.from("user_roles").delete().eq("user_id", uid);
      await admin.from("user_roles").insert({ user_id: uid, role: s.role });
      results.push({ email, id: uid, role: s.role, ok: true });
    }
    return new Response(JSON.stringify({ ok: true, results }, null, 2), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
