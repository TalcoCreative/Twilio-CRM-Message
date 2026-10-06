ALTER TABLE public.webinar_blast_recipients
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_status text,
  ADD COLUMN IF NOT EXISTS reminder_error text;
INSERT INTO public.system_settings(key, value, updated_at)
VALUES ('twilio_content_sid_webinar_reminder','HX77e0173b9c5f9e41072c830822f3d24f', now())
ON CONFLICT (key) DO NOTHING;