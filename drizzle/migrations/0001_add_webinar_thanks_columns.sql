ALTER TABLE public.webinar_blast_recipients
  ADD COLUMN IF NOT EXISTS thanks_status TEXT,
  ADD COLUMN IF NOT EXISTS thanks_error TEXT,
  ADD COLUMN IF NOT EXISTS thanks_sent_at TIMESTAMPTZ;

INSERT INTO public.system_settings (key, value)
VALUES ('twilio_content_sid_webinar_thanks', 'HX28219c9e13f1f6957e39e3a3d7e8bc65')
ON CONFLICT (key) DO NOTHING;