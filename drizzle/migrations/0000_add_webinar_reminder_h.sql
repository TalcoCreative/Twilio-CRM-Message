ALTER TABLE public.webinar_blast_recipients
  ADD COLUMN IF NOT EXISTS reminder_h_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_h_status text,
  ADD COLUMN IF NOT EXISTS reminder_h_error text;

INSERT INTO public.system_settings (key, value)
VALUES ('twilio_content_sid_webinar_reminder_h', 'HX4847d3a32d3cc90af60cdfb10acbf7df')
ON CONFLICT (key) DO NOTHING;