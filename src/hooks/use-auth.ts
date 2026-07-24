import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  isActive: boolean | null;
};

/**
 * Tracks the current Supabase session.
 *
 * Note: we intentionally do NOT force-signOut here based on `profiles.is_active`.
 * The gate for disabled accounts lives at login time (`src/routes/auth.tsx`) and
 * server-side (the `disable` action in `manage-agent` revokes all sessions via
 * `admin.auth.admin.signOut(target)`). Re-checking `is_active` on every auth
 * event was racing with fresh sign-ins and occasionally kicking valid users
 * (e.g. newly created agents) straight back to the login page.
 */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ session: null, user: null, loading: true, isActive: null });

  useEffect(() => {
    let mounted = true;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setState({
        session: session ?? null,
        user: session?.user ?? null,
        loading: false,
        isActive: session?.user ? true : null,
      });
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const session = data.session;
      setState({
        session: session ?? null,
        user: session?.user ?? null,
        loading: false,
        isActive: session?.user ? true : null,
      });
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
