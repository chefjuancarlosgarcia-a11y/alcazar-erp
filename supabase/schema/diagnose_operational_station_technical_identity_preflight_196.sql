-- Preflight for 196: counts eligible technical profiles vs human blockers (no PII).
-- Run in SQL Editor before applying 196_fix_operational_station_technical_identity.sql.

with device_profiles as (
  select p.id as profile_id
  from public.profiles p
  inner join public.operational_station_devices d on d.auth_user_id = p.id
  where d.auth_user_id is not null
)
select
  (
    select count(*)
    from device_profiles dp
    join public.profiles p on p.id = dp.profile_id
    where nullif(trim(coalesce(p.employee_id, '')), '') is not null
      or exists (select 1 from public.operational_credentials oc where oc.profile_id = p.id)
      or exists (select 1 from public.operational_station_assignments osa where osa.profile_id = p.id)
      or exists (
        select 1 from public.operational_operator_sessions oos where oos.operator_profile_id = p.id
      )
      or (
        to_regclass('public.pos_orders') is not null
        and exists (select 1 from public.pos_orders po where po.owner_profile_id = p.id)
      )
  ) as human_blocker_profiles,
  (
    select count(*)
    from device_profiles dp
    where exists (
      select 1
      from auth.users u
      where u.id = dp.profile_id
        and (
          coalesce(u.raw_app_meta_data ->> 'operational_station_device', 'false') = 'true'
          or coalesce(u.raw_user_meta_data ->> 'operational_station_device', 'false') = 'true'
        )
    )
  ) as eligible_technical_profiles_with_auth_marker,
  (select count(*) from device_profiles) as total_device_linked_profiles;
