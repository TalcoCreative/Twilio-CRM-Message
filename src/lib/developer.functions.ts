import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Mengembalikan connection string database cloud (SUPABASE_DB_URL) untuk
 * keperluan mirroring ke VPS. Hanya bisa dipanggil user yang sudah login;
 * UI-nya dilindungi PIN Developer Mode.
 */
export const getDatabaseUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const dbUrl = process.env["SUPABASE_DB_URL"] ?? null;
    return { dbUrl };
  });
