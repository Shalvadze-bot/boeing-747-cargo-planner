-- Normalize delayed Sites profile updates per account and reported name.
create table cargo_sites_private.profile_display_name_aliases (
  account_id text not null,
  reported_name text not null,
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  primary key (account_id, reported_name)
);

alter table cargo_sites_private.profile_display_name_aliases enable row level security;
revoke all on cargo_sites_private.profile_display_name_aliases from public, anon, authenticated;
grant select on cargo_sites_private.profile_display_name_aliases to service_role;

create or replace function public.cargo_sites_activity_request(
  worker_token text, operation text, site_owner text, site_email text, actor_name text,
  project_id uuid, project_name text, project_payload jsonb, expected_updated_at timestamptz, member_email text
)
returns jsonb language sql security invoker
set search_path = ''
as $$
  select cargo_sites_private.activity_request(
    $1, $2, $3, $4,
    coalesce((
      select a.display_name from cargo_sites_private.profile_display_name_aliases a
      where a.account_id = $3 and a.reported_name = $5
    ), $5),
    $6, $7, $8, $9, $10
  )
$$;

revoke all on function public.cargo_sites_activity_request(text, text, text, text, text, uuid, text, jsonb, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.cargo_sites_activity_request(text, text, text, text, text, uuid, text, jsonb, timestamptz, text)
  to service_role;
