REVOKE EXECUTE ON FUNCTION public.is_fr_restricted() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bpjs_contact_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_fr_restricted() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bpjs_contact_ids() TO authenticated;