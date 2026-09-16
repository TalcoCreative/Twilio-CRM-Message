-- 1) Helper: apakah user saat ini adalah FR terbatas (tanpa argumen baris)
CREATE OR REPLACE FUNCTION public.is_fr_restricted()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'first_response')
     AND NOT public.has_role(auth.uid(), 'agent')
     AND NOT public.is_admin(auth.uid())
$$;

GRANT EXECUTE ON FUNCTION public.is_fr_restricted() TO authenticated;

-- 2) Hapus kebijakan baca ganda (dobel evaluasi per baris)
DROP POLICY IF EXISTS fr_messages_visibility_guard ON public.messages;
DROP POLICY IF EXISTS fr_conversations_visibility_guard ON public.conversations;
DROP POLICY IF EXISTS fr_contacts_visibility_guard ON public.contacts;

-- 3) Kebijakan baca yang short-circuit untuk non-FR
DROP POLICY IF EXISTS msg_read_auth ON public.messages;
CREATE POLICY msg_read_auth ON public.messages FOR SELECT TO authenticated
USING ( NOT (SELECT public.is_fr_restricted()) OR public.fr_can_see_conversation(conversation_id) );

DROP POLICY IF EXISTS conv_read_auth ON public.conversations;
CREATE POLICY conv_read_auth ON public.conversations FOR SELECT TO authenticated
USING ( NOT (SELECT public.is_fr_restricted()) OR public.fr_can_see_conversation(id) );

DROP POLICY IF EXISTS contacts_read_auth ON public.contacts;
CREATE POLICY contacts_read_auth ON public.contacts FOR SELECT TO authenticated
USING ( NOT (SELECT public.is_fr_restricted()) OR public.fr_can_see_contact(id) );

-- 4) Index pencarian teks untuk kata kunci (BPJS/KIS/ASKES)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_messages_content_trgm ON public.messages USING gin (content gin_trgm_ops);

-- 5) Fungsi ringkas: daftar contact_id yang menyebut BPJS/KIS/ASKES
CREATE OR REPLACE FUNCTION public.bpjs_contact_ids()
RETURNS TABLE (contact_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT c.contact_id
  FROM public.messages m
  JOIN public.conversations c ON c.id = m.conversation_id
  WHERE m.content ~* '\m(bpjs|kis|askes)\M'
$$;

GRANT EXECUTE ON FUNCTION public.bpjs_contact_ids() TO authenticated;