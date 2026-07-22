create table if not exists public.outreach_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('Creator', 'Brand')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.outreach_entries enable row level security;

drop policy if exists "Users can read their own outreach entries" on public.outreach_entries;
drop policy if exists "Users can insert their own outreach entries" on public.outreach_entries;
drop policy if exists "Users can update their own outreach entries" on public.outreach_entries;
drop policy if exists "Users can delete their own outreach entries" on public.outreach_entries;

create policy "Users can read their own outreach entries"
  on public.outreach_entries for select
  using (auth.uid() = user_id);

create policy "Users can insert their own outreach entries"
  on public.outreach_entries for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own outreach entries"
  on public.outreach_entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own outreach entries"
  on public.outreach_entries for delete
  using (auth.uid() = user_id);
