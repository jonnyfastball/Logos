-- Debates table
create table if not exists public.debates (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'completed', 'cancelled')),
  user1_id uuid references auth.users(id),
  user2_id uuid references auth.users(id),
  winner_id uuid references auth.users(id),
  channel_id uuid,
  invite_code text unique,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz default now()
);

-- Add debate_id column to channels
alter table public.channels add column if not exists debate_id uuid references public.debates(id);

-- Enable RLS
alter table public.debates enable row level security;

-- RLS policies: authenticated users can read all debates
create policy "Authenticated users can view debates"
  on public.debates for select
  to authenticated
  using (true);

-- Authenticated users can insert debates
create policy "Authenticated users can create debates"
  on public.debates for insert
  to authenticated
  with check (auth.uid() = user1_id);

-- Users in a debate can update it
create policy "Debate participants can update debates"
  on public.debates for update
  to authenticated
  using (auth.uid() = user1_id or auth.uid() = user2_id);

-- Enable realtime on debates
alter publication supabase_realtime add table public.debates;

-- RPC: join_random_debate
-- Atomically claims a waiting debate or returns null
create or replace function public.join_random_debate(p_user_id uuid)
returns json
language plpgsql
security definer
as $$
declare
  v_debate public.debates;
  v_channel_id uuid;
begin
  -- Find and lock a waiting debate (not created by the joining user)
  select * into v_debate
  from public.debates
  where status = 'waiting'
    and user1_id != p_user_id
  order by created_at asc
  limit 1
  for update skip locked;

  if v_debate.id is null then
    return null;
  end if;

  -- Create a channel for this debate
  insert into public.channels (slug, created_by, inserted_at, debate_id)
  values (
    'debate-' || left(v_debate.id::text, 8),
    p_user_id,
    now()::text,
    v_debate.id
  )
  returning id into v_channel_id;

  -- Update the debate to active
  update public.debates
  set status = 'active',
      user2_id = p_user_id,
      channel_id = v_channel_id,
      started_at = now()
  where id = v_debate.id;

  return json_build_object(
    'debate_id', v_debate.id,
    'channel_id', v_channel_id,
    'topic', v_debate.topic,
    'user1_id', v_debate.user1_id,
    'user2_id', p_user_id
  );
end;
$$;
