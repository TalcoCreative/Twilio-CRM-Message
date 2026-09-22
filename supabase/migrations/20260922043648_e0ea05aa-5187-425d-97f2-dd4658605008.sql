CREATE TABLE public.webinars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL,
  zoom_link text NOT NULL DEFAULT '',
  message_template text NOT NULL DEFAULT 'Terima kasih sudah mendaftar webinar kami.

Berikut link Zoom Meeting:
{{link}}

Sampai jumpa di acara!',
  is_active boolean NOT NULL DEFAULT true,
  stop_chatbot boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX webinars_code_unique ON public.webinars (upper(code));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.webinars TO authenticated;
GRANT ALL ON public.webinars TO service_role;
ALTER TABLE public.webinars ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage webinars" ON public.webinars FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_webinars_updated BEFORE UPDATE ON public.webinars
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.webinar_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webinar_id uuid NOT NULL REFERENCES public.webinars(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  code_used text NOT NULL,
  message_sent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webinar_registrations_webinar_idx ON public.webinar_registrations (webinar_id, created_at DESC);
CREATE INDEX webinar_registrations_contact_idx ON public.webinar_registrations (contact_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.webinar_registrations TO authenticated;
GRANT ALL ON public.webinar_registrations TO service_role;
ALTER TABLE public.webinar_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view webinar registrations" ON public.webinar_registrations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert webinar registrations" ON public.webinar_registrations FOR INSERT TO authenticated WITH CHECK (true);