-- Add Glicko-2 rating columns to users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS rating double precision NOT NULL DEFAULT 1500.0,
  ADD COLUMN IF NOT EXISTS rating_deviation double precision NOT NULL DEFAULT 350.0,
  ADD COLUMN IF NOT EXISTS volatility double precision NOT NULL DEFAULT 0.06,
  ADD COLUMN IF NOT EXISTS total_debates integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wins integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS losses integer NOT NULL DEFAULT 0;

-- Add vote columns to debates
ALTER TABLE public.debates
  ADD COLUMN IF NOT EXISTS user1_vote text CHECK (user1_vote IN ('self', 'opponent', 'draw')),
  ADD COLUMN IF NOT EXISTS user2_vote text CHECK (user2_vote IN ('self', 'opponent', 'draw'));

-- Update status constraint to include 'voting'
ALTER TABLE public.debates DROP CONSTRAINT IF EXISTS debates_status_check;
ALTER TABLE public.debates
  ADD CONSTRAINT debates_status_check
  CHECK (status IN ('waiting', 'active', 'voting', 'completed', 'cancelled'));
