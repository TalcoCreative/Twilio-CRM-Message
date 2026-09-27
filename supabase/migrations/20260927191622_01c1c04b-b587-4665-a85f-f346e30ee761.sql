CREATE TABLE public.webinar_blast_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webinar_id uuid NOT NULL REFERENCES public.webinars(id) ON DELETE CASCADE,
  whatsapp_number text NOT NULL,
  full_name text,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  last_sent_at timestamptz,
  last_status text,
  last_error text,
  send_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (webinar_id, whatsapp_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webinar_blast_recipients TO authenticated;
GRANT ALL ON public.webinar_blast_recipients TO service_role;
ALTER TABLE public.webinar_blast_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage webinar blast recipients" ON public.webinar_blast_recipients
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE TRIGGER touch_webinar_blast_recipients BEFORE UPDATE ON public.webinar_blast_recipients
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
INSERT INTO public.system_settings (key, value) VALUES ('twilio_content_sid_webinar_blast', 'HX41f89191c36c51415223e2ba7c27429a')
  ON CONFLICT (key) DO NOTHING;