-- Add video debate support
ALTER TABLE public.debates
  ADD COLUMN IF NOT EXISTS is_video boolean DEFAULT false;

-- Update join_random_debate to match video/text seekers
CREATE OR REPLACE FUNCTION public.join_random_debate(p_user_id uuid, p_is_video boolean DEFAULT false)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_debate public.debates;
  v_channel_id bigint;
BEGIN
  -- Find and lock a waiting debate (not created by the joining user, matching video mode)
  SELECT * INTO v_debate
  FROM public.debates
  WHERE status = 'waiting'
    AND user1_id != p_user_id
    AND invite_code IS NULL
    AND is_video = p_is_video
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_debate.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Create a channel for this debate
  INSERT INTO public.channels (slug, created_by, inserted_at, debate_id)
  VALUES (
    'debate-' || left(v_debate.id::text, 8),
    p_user_id,
    now(),
    v_debate.id
  )
  RETURNING id INTO v_channel_id;

  -- Update the debate to active
  UPDATE public.debates
  SET status = 'active',
      user2_id = p_user_id,
      channel_id = v_channel_id,
      started_at = now()
  WHERE id = v_debate.id;

  RETURN json_build_object(
    'debate_id', v_debate.id,
    'channel_id', v_channel_id,
    'topic', v_debate.topic,
    'user1_id', v_debate.user1_id,
    'user2_id', p_user_id
  );
END;
$$;
