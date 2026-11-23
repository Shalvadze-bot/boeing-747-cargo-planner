create table if not exists public.cargo_plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.cargo_plans enable row level security;
alter table public.cargo_plans force row level security;

revoke all on table public.cargo_plans from anon, public;
grant select, insert, update, delete on table public.cargo_plans to authenticated;

drop policy if exists "Users can read their own cargo plan" on public.cargo_plans;
create policy "Users can read their own cargo plan"
  on public.cargo_plans for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own cargo plan" on public.cargo_plans;
create policy "Users can create their own cargo plan"
  on public.cargo_plans for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own cargo plan" on public.cargo_plans;
create policy "Users can update their own cargo plan"
  on public.cargo_plans for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own cargo plan" on public.cargo_plans;
create policy "Users can delete their own cargo plan"
  on public.cargo_plans for delete to authenticated
  using ((select auth.uid()) = user_id);
