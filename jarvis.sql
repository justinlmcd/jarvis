-- JARVIS: your conversation, kept with your account so every device shows it and Jarvis remembers it.
-- Run once in Supabase → SQL Editor (same project as the other apps). Safe to run again.
create table if not exists public.jarvis_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  text text not null,
  actions jsonb not null default '[]'::jsonb,   -- what Jarvis logged with this answer
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists jarvis_messages_user_idx on public.jarvis_messages (user_id, created_at desc);
alter table public.jarvis_messages enable row level security;
drop policy if exists jm_read on public.jarvis_messages;
drop policy if exists jm_write on public.jarvis_messages;
drop policy if exists jm_remove on public.jarvis_messages;
create policy jm_read on public.jarvis_messages for select to authenticated using (user_id = (select auth.uid()));
create policy jm_write on public.jarvis_messages for insert to authenticated with check (user_id = (select auth.uid()));
create policy jm_remove on public.jarvis_messages for delete to authenticated using (user_id = (select auth.uid()));
