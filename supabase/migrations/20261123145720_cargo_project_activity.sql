alter table public.cargo_projects
  add column last_changed_by text;

-- Authenticated legacy clients retain plan writes, but cannot forge attribution.
revoke insert, update on public.cargo_projects from authenticated;
grant insert (user_id, name, payload) on public.cargo_projects to authenticated;
grant update (name, payload, updated_at) on public.cargo_projects to authenticated;

create table cargo_sites_private.project_viewers (
  project_id uuid not null references public.cargo_projects(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  primary key (project_id, email)
);
create index cargo_viewer_email_idx on cargo_sites_private.project_viewers (email, project_id);

create table cargo_sites_private.project_presence (
  project_id uuid not null references public.cargo_projects(id) on delete cascade,
  account_id text not null,
  display_name text not null,
  viewer_email text,
  seen_at timestamptz not null,
  primary key (project_id, account_id)
);
create index cargo_presence_expiry_idx on cargo_sites_private.project_presence (seen_at);
alter table cargo_sites_private.project_viewers enable row level security;
alter table cargo_sites_private.project_presence enable row level security;

create function cargo_sites_private.online_visitors(target_project uuid)
returns table(account_id text, display_name text)
language sql stable
set search_path = ''
as $$
  select v.account_id, v.display_name
  from cargo_sites_private.project_presence v
  where v.project_id = target_project
    and v.seen_at >= statement_timestamp() - interval '45 seconds'
    and (v.viewer_email is null or exists (
      select 1 from cargo_sites_private.project_viewers m
      where m.project_id = v.project_id and m.email = v.viewer_email
    ))
$$;

create function cargo_sites_private.activity_request(
  worker_token text, operation text, site_owner text, site_email text, actor_name text,
  project_id uuid, project_name text, project_payload jsonb, expected_updated_at timestamptz, member_email text
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  legacy_id uuid;
  project public.cargo_projects%rowtype;
  account_email text := lower(btrim(site_email));
  target_email text := lower(btrim(member_email));
  display_actor text := coalesce(nullif(left(btrim(actor_name), 100), ''), 'ChatGPT kullanıcısı');
  is_owner boolean;
  can_view boolean;
  changed jsonb;
begin
  if worker_token is null or worker_token !~ '^[a-f0-9]{64}$'
    or site_owner is null or length(site_owner) not between 1 and 255
    or account_email is null or length(account_email) not between 3 and 254
    or not exists (
      select 1 from cargo_sites_private.worker_credential
      where token_digest = extensions.digest(worker_token, 'sha256')
    )
  then
    raise insufficient_privilege using message = 'Unauthorized cargo worker';
  end if;

  select l.legacy_user into legacy_id from cargo_sites_private.account_links l
  where l.site_owner = site_owner;

  if operation = 'list' then
    if legacy_id is null then
      insert into cargo_sites_private.account_links (site_owner, legacy_user)
      select site_owner, u.id from auth.users u
      where u.email_confirmed_at is not null and lower(u.email) = account_email
        and exists (select 1 from public.cargo_projects p where p.user_id = u.id)
      on conflict do nothing;
      select l.legacy_user into legacy_id from cargo_sites_private.account_links l
      where l.site_owner = site_owner;
    end if;
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'created_at', p.created_at, 'updated_at', p.updated_at,
        'last_changed_by', p.last_changed_by,
        'can_edit', coalesce(p.site_owner_id = site_owner or p.user_id = legacy_id, false),
        'online_count', (select count(*) from cargo_sites_private.online_visitors(p.id))
      ) order by p.updated_at desc)
      from public.cargo_projects p
      where p.site_owner_id = site_owner or p.user_id = legacy_id or exists (
        select 1 from cargo_sites_private.project_viewers m where m.project_id = p.id and m.email = account_email
      )
    ), '[]'::jsonb);
  end if;

  -- Retain the existing name/payload validation and optimistic version check.
  if operation = 'create' then
    changed := cargo_sites_private.request(worker_token, operation, site_owner, site_email,
      project_id, project_name, project_payload, expected_updated_at);
    update public.cargo_projects p set last_changed_by = display_actor
    where p.id = (changed->>'id')::uuid;
    return changed || jsonb_build_object('last_changed_by', display_actor, 'can_edit', true, 'online_count', 0);
  end if;

  -- Select only metadata here. The full payload is fetched only to open a project.
  select coalesce(p.site_owner_id = site_owner or p.user_id = legacy_id, false), p.updated_at, p.last_changed_by
    into is_owner, project.updated_at, project.last_changed_by
  from public.cargo_projects p where p.id = project_id;
  if not found then return jsonb_build_object('notFound', true); end if;

  can_view := is_owner or exists (
    select 1 from cargo_sites_private.project_viewers m
    where m.project_id = project_id and m.email = account_email
  );
  if not can_view then return jsonb_build_object('notFound', true); end if;

  if operation = 'read' then
    select p.* into project from public.cargo_projects p where p.id = project_id;
    return jsonb_build_object('id', project.id, 'name', project.name, 'created_at', project.created_at,
      'updated_at', project.updated_at, 'last_changed_by', project.last_changed_by,
      'can_edit', is_owner, 'payload', project.payload);
  end if;

  if operation = 'version' then
    return jsonb_build_object('updated_at', project.updated_at, 'last_changed_by', project.last_changed_by);
  end if;

  if operation = 'presence' then
    delete from cargo_sites_private.project_presence v
    where v.seen_at < statement_timestamp() - interval '2 minutes';

    insert into cargo_sites_private.project_presence (project_id, account_id, display_name, viewer_email, seen_at)
    values (project_id, site_owner, display_actor, case when is_owner then null else account_email end, statement_timestamp())
    on conflict on constraint project_presence_pkey do update
      set display_name = excluded.display_name, viewer_email = excluded.viewer_email, seen_at = excluded.seen_at;

    return jsonb_build_object(
      'updated_at', project.updated_at, 'last_changed_by', project.last_changed_by,
      'online', coalesce((
        select jsonb_agg(jsonb_build_object('name', v.display_name, 'you', v.account_id = site_owner)
          order by (v.account_id = site_owner) desc, v.display_name, v.account_id)
        from cargo_sites_private.online_visitors(project_id) v
      ), '[]'::jsonb)
    );
  end if;

  if not is_owner then return jsonb_build_object('forbidden', true); end if;

  if operation in ('members', 'grant', 'revoke') then
    if operation in ('grant', 'revoke')
      and (target_email is null or length(target_email) not between 3 and 254 or target_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')
    then
      raise invalid_parameter_value using message = 'Invalid viewer email';
    end if;
    if operation = 'grant' and target_email <> account_email then
      insert into cargo_sites_private.project_viewers (project_id, email)
      values (project_id, target_email) on conflict do nothing;
    elsif operation = 'revoke' then
      delete from cargo_sites_private.project_viewers m where m.project_id = project_id and m.email = target_email;
      delete from cargo_sites_private.project_presence v where v.project_id = project_id and v.viewer_email = target_email;
    end if;
    return jsonb_build_object('members', coalesce((
      select jsonb_agg(m.email order by m.email)
      from cargo_sites_private.project_viewers m where m.project_id = project_id
    ), '[]'::jsonb));
  end if;

  if operation in ('save', 'rename') then
    -- Lock before comparing so a no-op save cannot overwrite or reattribute a concurrent edit.
    select p.* into project from public.cargo_projects p where p.id = project_id for update;
    if project.id is null then return jsonb_build_object('notFound', true); end if;
    if operation = 'save' and project.updated_at is distinct from expected_updated_at then
      return jsonb_build_object('conflict', true);
    end if;
    if operation = 'save' and project.payload = project_payload then
      return jsonb_build_object('updated_at', project.updated_at, 'last_changed_by', project.last_changed_by);
    end if;
    if operation = 'rename' and project.name = trim(project_name) then
      return jsonb_build_object('id', project.id, 'name', project.name, 'created_at', project.created_at,
        'updated_at', project.updated_at, 'last_changed_by', project.last_changed_by, 'can_edit', true,
        'online_count', (select count(*) from cargo_sites_private.online_visitors(project_id)));
    end if;

    changed := cargo_sites_private.request(worker_token, operation, site_owner, site_email,
      project_id, project_name, project_payload, expected_updated_at);
    if changed ? 'notFound' or changed ? 'conflict' then return changed; end if;
    update public.cargo_projects p set last_changed_by = display_actor where p.id = project_id;
    return changed || jsonb_build_object('last_changed_by', display_actor, 'can_edit', true,
      'online_count', (select count(*) from cargo_sites_private.online_visitors(project_id)));
  end if;

  if operation = 'delete' then
    return cargo_sites_private.request(worker_token, operation, site_owner, site_email,
      project_id, project_name, project_payload, expected_updated_at);
  end if;
  raise invalid_parameter_value using message = 'Unknown operation';
end;
$$;
revoke all on function cargo_sites_private.online_visitors(uuid) from public, anon, authenticated;
revoke all on function cargo_sites_private.activity_request(text, text, text, text, text, uuid, text, jsonb, timestamptz, text)
  from public, anon, authenticated;
grant execute on function cargo_sites_private.activity_request(text, text, text, text, text, uuid, text, jsonb, timestamptz, text) to service_role;

create function public.cargo_sites_activity_request(
  worker_token text, operation text, site_owner text, site_email text, actor_name text,
  project_id uuid, project_name text, project_payload jsonb, expected_updated_at timestamptz, member_email text
)
returns jsonb language sql security invoker
set search_path = ''
as $$
  select cargo_sites_private.activity_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
$$;
revoke all on function public.cargo_sites_activity_request(text, text, text, text, text, uuid, text, jsonb, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.cargo_sites_activity_request(text, text, text, text, text, uuid, text, jsonb, timestamptz, text)
  to service_role;
