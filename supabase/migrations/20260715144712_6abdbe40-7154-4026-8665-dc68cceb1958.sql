ALTER TABLE public.stages ADD COLUMN IF NOT EXISTS is_won boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_stage_is_won ON public.stages ((is_won)) WHERE is_won = true;