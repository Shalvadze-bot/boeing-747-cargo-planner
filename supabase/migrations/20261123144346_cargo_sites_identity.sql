create schema cargo_sites_private;
revoke all on schema cargo_sites_private from public, anon, authenticated;
grant usage on schema cargo_sites_private to service_role;

create table cargo_sites_private.worker_credential (
  singleton boolean primary key default true check (singleton),
  token_digest bytea not null check (octet_length(token_digest) = 32)
);
create table cargo_sites_private.account_links (
  site_owner text primary key,
  legacy_user uuid not null unique references auth.users (id) on delete cascade
);
alter table cargo_sites_private.worker_credential enable row level security;
alter table cargo_sites_private.account_links enable row level security;

alter table public.cargo_projects
  alter column user_id drop not null,
  add column site_owner_id text,
  add constraint cargo_projects_one_owner check (num_nonnulls(user_id, site_owner_id) = 1);
create index cargo_projects_site_owner_updated_idx
  on public.cargo_projects (site_owner_id, updated_at desc) where site_owner_id is not null;

create function cargo_sites_private.request(
  worker_token text, operation text, site_owner text, site_email text,
  project_id uuid, project_name text, project_payload jsonb, expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  legacy_id uuid;
  project public.cargo_projects%rowtype;
begin
  if worker_token is null or worker_token !~ '^[a-f0-9]{64}$'
    or site_owner is null or length(site_owner) not between 1 and 255
    or not exists (
      select 1 from cargo_sites_private.worker_credential
      where token_digest = extensions.digest(worker_token, 'sha256')
    )
  then
    raise insufficient_privilege using message = 'Unauthorized cargo worker';
  end if;

  select l.legacy_user into legacy_id
  from cargo_sites_private.account_links l where l.site_owner = request.site_owner;

  -- Associate pre-existing Supabase plans with a matching verified Sites account once.
  if operation = 'list' and legacy_id is null and site_email is not null then
    insert into cargo_sites_private.account_links (site_owner, legacy_user)
    select site_owner, u.id from auth.users u
    where u.email_confirmed_at is not null
      and lower(u.email) = lower(site_email)
      and exists (select 1 from public.cargo_projects p where p.user_id = u.id)
    on conflict do nothing;
    select l.legacy_user into legacy_id
    from cargo_sites_private.account_links l where l.site_owner = request.site_owner;
  end if;

  if operation = 'list' then
    return coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name,
        'created_at', p.created_at, 'updated_at', p.updated_at) order by p.updated_at desc)
      from public.cargo_projects p where p.site_owner_id = site_owner or p.user_id = legacy_id
    ), '[]'::jsonb);
  end if;

  if operation in ('create', 'rename')
    and (project_name is null or char_length(trim(project_name)) not between 1 and 80)
  then
    raise invalid_parameter_value using message = 'Invalid project name';
  end if;
  if operation in ('create', 'save')
    and (jsonb_typeof(project_payload) is distinct from 'object'
      or project_payload->'version' is distinct from '1'::jsonb
      or (project_payload->'aircraft' is distinct from 'null'::jsonb and jsonb_typeof(project_payload->'aircraft') is distinct from 'object')
      or (project_payload->'pmc' is distinct from 'null'::jsonb and jsonb_typeof(project_payload->'pmc') is distinct from 'object')
      or (project_payload ? 'recovery' and jsonb_typeof(project_payload->'recovery') is distinct from 'array')
      or octet_length(project_payload::text) > 4000000)
  then
    raise invalid_parameter_value using message = 'Invalid project payload';
  end if;

  if operation = 'create' then
    insert into public.cargo_projects (site_owner_id, name, payload)
    values (site_owner, trim(project_name), project_payload) returning * into project;
  elsif operation in ('read', 'version') then
    select p.* into project from public.cargo_projects p
    where p.id = project_id and (p.site_owner_id = site_owner or p.user_id = legacy_id);
  elsif operation = 'save' then
    update public.cargo_projects p set payload = project_payload, updated_at = clock_timestamp()
    where p.id = project_id and (p.site_owner_id = site_owner or p.user_id = legacy_id)
      and p.updated_at = expected_updated_at
    returning * into project;
    if project.id is null and exists (
      select 1 from public.cargo_projects p
      where p.id = project_id and (p.site_owner_id = site_owner or p.user_id = legacy_id)
    ) then
      return jsonb_build_object('conflict', true);
    end if;
  elsif operation = 'rename' then
    update public.cargo_projects p set name = trim(project_name), updated_at = clock_timestamp()
    where p.id = project_id and (p.site_owner_id = site_owner or p.user_id = legacy_id)
    returning * into project;
  elsif operation = 'delete' then
    delete from public.cargo_projects p
    where p.id = project_id and (p.site_owner_id = site_owner or p.user_id = legacy_id)
    returning * into project;
  else
    raise invalid_parameter_value using message = 'Unknown operation';
  end if;

  if project.id is null then return jsonb_build_object('notFound', true); end if;
  if operation in ('save', 'version') then
    return jsonb_build_object('updated_at', project.updated_at);
  end if;
  if operation in ('create', 'read') then
    return jsonb_build_object('id', project.id, 'name', project.name,
      'created_at', project.created_at, 'updated_at', project.updated_at, 'payload', project.payload);
  end if;
  return jsonb_build_object('id', project.id, 'name', project.name,
    'created_at', project.created_at, 'updated_at', project.updated_at);
end;
$$;
revoke all on function cargo_sites_private.request(text, text, text, text, uuid, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function cargo_sites_private.request(text, text, text, text, uuid, text, jsonb, timestamptz) to service_role;

create function public.cargo_sites_request(
  worker_token text, operation text, site_owner text, site_email text,
  project_id uuid, project_name text, project_payload jsonb, expected_updated_at timestamptz
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select cargo_sites_private.request($1, $2, $3, $4, $5, $6, $7, $8);
$$;
revoke all on function public.cargo_sites_request(text, text, text, text, uuid, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.cargo_sites_request(text, text, text, text, uuid, text, jsonb, timestamptz) to service_role;
