-- Add AI opponent flag and outcome tracking to debates
ALTER TABLE public.debates
  ADD COLUMN IF NOT EXISTS is_ai_opponent boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS outcome text;
