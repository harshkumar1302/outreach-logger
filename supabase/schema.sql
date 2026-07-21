create table if not exists public.outreach_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('Creator', 'Brand')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.outreach_entries enable row level security;

create policy "Users can read their own outreach entries"
  on public.outreach_entries for select
  using (auth.uid() = user_id);
