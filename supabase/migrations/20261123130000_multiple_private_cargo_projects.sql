drop table if exists public.cargo_plans;

create table public.cargo_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cargo_projects_owner_updated_idx on public.cargo_projects (user_id, updated_at desc);
alter table public.cargo_projects enable row level security;
alter table public.cargo_projects force row level security;

revoke all on table public.cargo_projects from anon, public;
grant select, insert, update, delete on table public.cargo_projects to authenticated;

create policy "Users can read their own cargo projects"
  on public.cargo_projects for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their own cargo projects"
  on public.cargo_projects for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their own cargo projects"
  on public.cargo_projects for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their own cargo projects"
  on public.cargo_projects for delete to authenticated
  using ((select auth.uid()) = user_id);
