CREATE OR REPLACE FUNCTION public.fr_user_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(array_agg(DISTINCT user_id), '{}') FROM public.user_roles WHERE role = 'first_response'
$$;

CREATE OR REPLACE FUNCTION public.fr_visible_contact_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT ct.id FROM public.contacts ct
  WHERE NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.contact_id = ct.id)
  UNION
  SELECT c.contact_id FROM public.conversations c
  WHERE c.assigned_agent_id IS NULL OR c.assigned_agent_id = auth.uid()
     OR c.assigned_agent_id IN (SELECT unnest(public.fr_user_ids()))
$$;

DROP POLICY IF EXISTS conv_read_auth ON public.conversations;
CREATE POLICY conv_read_auth ON public.conversations FOR SELECT TO authenticated
USING (
  NOT (SELECT public.is_fr_restricted())
  OR assigned_agent_id IS NULL
  OR assigned_agent_id = (SELECT auth.uid())
  OR assigned_agent_id IN (SELECT unnest(public.fr_user_ids()))
);

DROP POLICY IF EXISTS contacts_read_auth ON public.contacts;
CREATE POLICY contacts_read_auth ON public.contacts FOR SELECT TO authenticated
USING (
  NOT (SELECT public.is_fr_restricted())
  OR id IN (SELECT public.fr_visible_contact_ids())
);