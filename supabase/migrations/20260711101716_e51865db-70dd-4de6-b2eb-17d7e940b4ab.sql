
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE TABLE IF NOT EXISTS public.whatsapp_gateway_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  direction TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  event TEXT NOT NULL,
  message_sid TEXT,
  conversation_id UUID,
  to_number TEXT,
  status TEXT,
  error_code TEXT,
  error_message TEXT,
  payload JSONB
);

CREATE INDEX IF NOT EXISTS idx_gw_logs_created ON public.whatsapp_gateway_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gw_logs_sid ON public.whatsapp_gateway_logs (message_sid);

GRANT SELECT ON public.whatsapp_gateway_logs TO authenticated;
GRANT ALL ON public.whatsapp_gateway_logs TO service_role;

ALTER TABLE public.whatsapp_gateway_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gw_logs_read_auth" ON public.whatsapp_gateway_logs;
CREATE POLICY "gw_logs_read_auth" ON public.whatsapp_gateway_logs
  FOR SELECT TO authenticated USING (true);
