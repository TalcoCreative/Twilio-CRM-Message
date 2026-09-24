CREATE OR REPLACE FUNCTION public.is_webinar_conversation(_conv_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.webinar_registrations wr
    JOIN public.conversations c ON c.id = _conv_id
    WHERE wr.conversation_id = _conv_id OR wr.contact_id = c.contact_id
  )
$$;

CREATE OR REPLACE FUNCTION public.fr_webinar_locked(_user_id uuid, _conv_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.has_role(_user_id, 'first_response')
     AND NOT public.has_role(_user_id, 'agent')
     AND NOT public.is_admin(_user_id)
     AND public.is_webinar_conversation(_conv_id)
$$;

DROP POLICY IF EXISTS "FR cannot write to webinar conversations" ON public.messages;
CREATE POLICY "FR cannot write to webinar conversations" ON public.messages
AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (NOT public.fr_webinar_locked(auth.uid(), conversation_id));