-- 196: Remove accidental human profiles for operational station device auth users.
-- Scope: profiles.id = operational_station_devices.auth_user_id with auth metadata marker when visible.
-- Does NOT touch PIN, assignments, Caja Principal, movements, or operational_station_access flag.

begin;

do $$
declare
  v_human_blockers integer;
  v_eligible integer;
begin
  if to_regclass('public.operational_station_devices') is null then
    raise exception '196_requires_operational_station_devices';
  end if;

  select count(*) into v_human_blockers
  from public.profiles p
  inner join public.operational_station_devices d on d.auth_user_id = p.id
  where d.auth_user_id is not null
    and (
      nullif(trim(coalesce(p.employee_id, '')), '') is not null
      or exists (
        select 1 from public.operational_credentials oc where oc.profile_id = p.id
      )
      or exists (
        select 1 from public.operational_station_assignments osa where osa.profile_id = p.id
      )
      or exists (
        select 1
        from public.operational_operator_sessions oos
        where oos.operator_profile_id = p.id
      )
      or (
        to_regclass('public.pos_orders') is not null
        and exists (
          select 1 from public.pos_orders po where po.owner_profile_id = p.id
        )
      )
    );

  if v_human_blockers > 0 then
    raise exception
      '196_preflight_blocked: % device-linked profile(s) have human/financial dependencies',
      v_human_blockers;
  end if;

  select count(*) into v_eligible
  from public.profiles p
  inner join public.operational_station_devices d on d.auth_user_id = p.id
  where d.auth_user_id is not null
    and exists (
      select 1
      from auth.users u
      where u.id = p.id
        and (
          coalesce(u.raw_app_meta_data ->> 'operational_station_device', 'false') = 'true'
          or coalesce(u.raw_user_meta_data ->> 'operational_station_device', 'false') = 'true'
        )
    );

  if v_eligible = 0 then
    raise notice '196_no_op: no eligible technical profiles to remove';
  end if;
end $$;

delete from public.profiles p
using public.operational_station_devices d
where p.id = d.auth_user_id
  and d.auth_user_id is not null
  and exists (
    select 1
    from auth.users u
    where u.id = p.id
      and (
        coalesce(u.raw_app_meta_data ->> 'operational_station_device', 'false') = 'true'
        or coalesce(u.raw_user_meta_data ->> 'operational_station_device', 'false') = 'true'
      )
  );

commit;
