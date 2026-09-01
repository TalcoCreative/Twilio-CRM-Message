ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS lead_temperature text;
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_lead_temperature_check;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_lead_temperature_check CHECK (lead_temperature IS NULL OR lead_temperature IN ('HOT','WARM','COLD'));
CREATE INDEX IF NOT EXISTS idx_contacts_lead_temperature ON public.contacts (lead_temperature);