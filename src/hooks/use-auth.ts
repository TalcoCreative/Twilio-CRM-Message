import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  isActive: boolean | null;
};

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ session: null, user: null, loading: true, isActive: null });

  useEffect(() => {
    async function refresh() {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session?.user) {
        setState({ session: null, user: null, loading: false, isActive: null });
        return;
      }
      const { data: prof } = await supabase.from("profiles").select("is_active").eq("id", session.user.id).maybeSingle();
      if (prof?.is_active === false) {
        await supabase.auth.signOut();
        setState({ session: null, user: null, loading: false, isActive: false });
        return;
      }
      setState({ session, user: session.user, loading: false, isActive: prof?.is_active ?? true });
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session?.user) {
        setState({ session: null, user: null, loading: false, isActive: null });
        return;
      }
      // Defer profile check to avoid deadlock inside auth callback
      setTimeout(() => {
        supabase.from("profiles").select("is_active").eq("id", session.user.id).maybeSingle().then(({ data: prof }) => {
          if (prof?.is_active === false) {
            supabase.auth.signOut().then(() => {
              setState({ session: null, user: null, loading: false, isActive: false });
            });
          } else {
            setState({ session, user: session.user, loading: false, isActive: prof?.is_active ?? true });
          }
        });
      }, 0);
    });

    refresh();
    return () => sub.subscription.unsubscribe();
  }, []);

  return state;
}
