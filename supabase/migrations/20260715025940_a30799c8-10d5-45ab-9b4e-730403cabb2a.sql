
CREATE OR REPLACE FUNCTION public.fr_can_see_conversation(_conv_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.has_role(auth.uid(), 'first_response')
      AND NOT public.has_role(auth.uid(), 'agent')
      AND NOT public.is_admin(auth.uid())
    THEN EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = _conv_id
        AND (
          c.assigned_agent_id IS NULL
          OR c.assigned_agent_id = auth.uid()
          OR public.has_role(c.assigned_agent_id, 'first_response')
        )
    )
    ELSE true
  END
$function$;

CREATE OR REPLACE FUNCTION public.fr_can_see_contact(_contact_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.has_role(auth.uid(), 'first_response')
      AND NOT public.has_role(auth.uid(), 'agent')
      AND NOT public.is_admin(auth.uid())
    THEN (
      -- Contact tanpa conversation: masih boleh dilihat FR (lead baru).
      NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.contact_id = _contact_id)
      OR EXISTS (
        SELECT 1
        FROM public.conversations c
        WHERE c.contact_id = _contact_id
          AND (
            c.assigned_agent_id IS NULL
            OR c.assigned_agent_id = auth.uid()
            OR public.has_role(c.assigned_agent_id, 'first_response')
          )
      )
    )
    ELSE true
  END
$function$;
