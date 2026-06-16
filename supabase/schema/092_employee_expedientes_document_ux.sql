-- Employee expedientes: no_expires + update/remove current document
-- Apply after 091_restrict_employee_expedientes_access.sql

alter table public.employee_file_versions
  add column if not exists no_expires boolean not null default false;

comment on column public.employee_file_versions.no_expires is
  'When true, document is treated as non-expiring regardless of expires_at.';

-- ---------------------------------------------------------------------------
-- Expiry status (supports manual no-expires)
-- ---------------------------------------------------------------------------

create or replace function public.employee_file_expiry_status(
  p_expires_at date,
  p_no_expires boolean default false
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_no_expires, false) then 'none'
    when p_expires_at is null then 'none'
    when p_expires_at < current_date then 'expired'
    when p_expires_at <= current_date + 15 then 'orange'
    when p_expires_at <= current_date + 30 then 'warning'
    else 'valid'
  end;
$$;

-- Backward-compatible wrapper (single-arg callers)
create or replace function public.employee_file_expiry_status(p_expires_at date)
returns text
language sql
immutable
set search_path = ''
as $$
  select public.employee_file_expiry_status(p_expires_at, false);
$$;

-- ---------------------------------------------------------------------------
-- RPC: register uploaded file version (+ no_expires)
-- ---------------------------------------------------------------------------

drop function if exists public.register_employee_file_version(uuid, text, text, text, text, bigint, date, date, text, text, jsonb);

create or replace function public.register_employee_file_version(
  p_profile_id uuid,
  p_file_type_code text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text default null,
  p_file_size bigint default null,
  p_issued_at date default null,
  p_expires_at date default null,
  p_no_expires boolean default false,
  p_signature_status text default null,
  p_notes text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.employee_file_types;
  v_file public.employee_files;
  v_version public.employee_file_versions;
  v_next_version integer := 1;
  v_no_expires boolean := coalesce(p_no_expires, false);
  v_expires_at date := case when v_no_expires then null else p_expires_at end;
begin
  if not public.can_write_employee_expedientes() then
    raise exception 'No tienes permiso para cargar documentos.';
  end if;

  select * into v_type
  from public.employee_file_types
  where code = p_file_type_code;

  if not found then
    raise exception 'Tipo de documento invalido: %.', p_file_type_code;
  end if;

  insert into public.employee_files (profile_id, file_type_code, signature_status, metadata)
  values (
    p_profile_id,
    p_file_type_code,
    case when v_type.requires_signature then coalesce(p_signature_status, 'pending') else null end,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (profile_id, file_type_code) do update set
    signature_status = case
      when v_type.requires_signature then coalesce(excluded.signature_status, employee_files.signature_status)
      else employee_files.signature_status
    end,
    metadata = employee_files.metadata || excluded.metadata,
    updated_at = now()
  returning * into v_file;

  select coalesce(max(version_number), 0) + 1
  into v_next_version
  from public.employee_file_versions
  where employee_file_id = v_file.id;

  if not v_type.allows_multiple then
    update public.employee_file_versions
    set is_current = false
    where employee_file_id = v_file.id and is_current = true;
  end if;

  insert into public.employee_file_versions (
    employee_file_id, profile_id, file_type_code, version_number,
    storage_path, file_name, mime_type, file_size,
    issued_at, expires_at, no_expires, uploaded_by, notes, is_current
  )
  values (
    v_file.id, p_profile_id, p_file_type_code, v_next_version,
    p_storage_path, p_file_name, p_mime_type, p_file_size,
    p_issued_at, v_expires_at, v_no_expires, auth.uid(), p_notes, true
  )
  returning * into v_version;

  update public.employee_files
  set current_version_id = v_version.id, updated_at = now()
  where id = v_file.id;

  begin
    perform public.sync_employee_expediente_alerts(p_profile_id);
  exception
    when others then
      raise warning 'sync_employee_expediente_alerts failed for %: %', p_profile_id, sqlerrm;
  end;

  return jsonb_build_object('file', to_jsonb(v_file), 'version', to_jsonb(v_version));
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: update current document metadata (no new file)
-- ---------------------------------------------------------------------------

create or replace function public.update_employee_file_current(
  p_profile_id uuid,
  p_file_type_code text,
  p_issued_at date default null,
  p_expires_at date default null,
  p_no_expires boolean default false,
  p_signature_status text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.employee_file_types;
  v_file public.employee_files;
  v_version public.employee_file_versions;
  v_no_expires boolean := coalesce(p_no_expires, false);
  v_expires_at date := case when v_no_expires then null else p_expires_at end;
begin
  if not public.can_write_employee_expedientes() then
    raise exception 'No tienes permiso para editar documentos.';
  end if;

  select * into v_type from public.employee_file_types where code = p_file_type_code;
  if not found then
    raise exception 'Tipo de documento invalido: %.', p_file_type_code;
  end if;

  select * into v_file
  from public.employee_files
  where profile_id = p_profile_id and file_type_code = p_file_type_code;

  if not found or v_file.current_version_id is null then
    raise exception 'No hay documento cargado para actualizar.';
  end if;

  select * into v_version
  from public.employee_file_versions
  where id = v_file.current_version_id
  for update;

  if not found then
    raise exception 'Version actual no encontrada.';
  end if;

  update public.employee_file_versions
  set
    issued_at = p_issued_at,
    expires_at = v_expires_at,
    no_expires = v_no_expires,
    notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = v_version.id;

  if v_type.requires_signature then
    update public.employee_files
    set
      signature_status = coalesce(nullif(trim(coalesce(p_signature_status, '')), ''), signature_status),
      updated_at = now()
    where id = v_file.id
    returning * into v_file;
  else
    update public.employee_files set updated_at = now() where id = v_file.id returning * into v_file;
  end if;

  select * into v_version from public.employee_file_versions where id = v_version.id;

  begin
    perform public.sync_employee_expediente_alerts(p_profile_id);
  exception
    when others then
      raise warning 'sync_employee_expediente_alerts failed for %: %', p_profile_id, sqlerrm;
  end;

  return jsonb_build_object('file', to_jsonb(v_file), 'version', to_jsonb(v_version));
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: remove current document (keep version history)
-- ---------------------------------------------------------------------------

create or replace function public.remove_employee_file_current(
  p_profile_id uuid,
  p_file_type_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file public.employee_files;
begin
  if not public.can_write_employee_expedientes() then
    raise exception 'No tienes permiso para eliminar documentos.';
  end if;

  select * into v_file
  from public.employee_files
  where profile_id = p_profile_id and file_type_code = p_file_type_code
  for update;

  if not found or v_file.current_version_id is null then
    raise exception 'No hay documento activo para eliminar.';
  end if;

  update public.employee_file_versions
  set is_current = false
  where id = v_file.current_version_id;

  update public.employee_files
  set current_version_id = null, updated_at = now()
  where id = v_file.id;

  begin
    perform public.sync_employee_expediente_alerts(p_profile_id);
  exception
    when others then
      raise warning 'sync_employee_expediente_alerts failed for %: %', p_profile_id, sqlerrm;
  end;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Detail RPC: expiry with no_expires + all types in files list
-- ---------------------------------------------------------------------------

create or replace function public.get_employee_expediente_detail(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_extra public.employee_file_profiles;
begin
  if not public.can_read_employee_expedientes() then
    raise exception 'No tienes permiso para consultar expedientes.';
  end if;

  select * into v_profile from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Colaborador no encontrado.';
  end if;

  select * into v_extra from public.employee_file_profiles where profile_id = p_profile_id;

  return jsonb_build_object(
    'profile', to_jsonb(v_profile),
    'extra', coalesce(to_jsonb(v_extra), '{}'::jsonb),
    'completeness', public.employee_expediente_completeness(p_profile_id),
    'status', public.employee_expediente_status(p_profile_id),
    'summary', jsonb_build_object(
      'valid_count', (
        select count(*)
        from public.employee_file_versions v
        where v.profile_id = p_profile_id and v.is_current = true
          and public.employee_file_expiry_status(v.expires_at, v.no_expires) in ('valid', 'none')
      ),
      'expired_count', (
        select count(*)
        from public.employee_file_versions v
        where v.profile_id = p_profile_id and v.is_current = true
          and public.employee_file_expiry_status(v.expires_at, v.no_expires) = 'expired'
      ),
      'missing_count', coalesce((public.employee_expediente_completeness(p_profile_id) ->> 'missing_count')::integer, 0)
    ),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
        'file', to_jsonb(f),
        'type', to_jsonb(ft),
        'current_version', (
          select to_jsonb(v)
          from public.employee_file_versions v
          where v.id = f.current_version_id
        ),
        'versions', coalesce((
          select jsonb_agg(to_jsonb(v) order by v.version_number desc)
          from public.employee_file_versions v
          where v.employee_file_id = f.id
        ), '[]'::jsonb),
        'expiry_status', (
          select public.employee_file_expiry_status(v.expires_at, v.no_expires)
          from public.employee_file_versions v
          where v.id = f.current_version_id
        )
      ) order by ft.sort_order)
      from public.employee_files f
      join public.employee_file_types ft on ft.code = f.file_type_code
      where f.profile_id = p_profile_id
    ), '[]'::jsonb),
    'types', coalesce((
      select jsonb_agg(to_jsonb(ft) order by ft.sort_order)
      from public.employee_file_types ft
    ), '[]'::jsonb),
    'labor_history', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.effective_date desc nulls last, h.created_at desc)
      from public.employee_labor_history h
      where h.profile_id = p_profile_id
    ), '[]'::jsonb),
    'alerts', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc)
      from public.employee_file_alerts a
      where a.profile_id = p_profile_id and a.resolved_at is null
    ), '[]'::jsonb),
    'can_write', public.can_write_employee_expedientes(),
    'requires_food_handling', public.is_food_handling_area(v_profile.area_name, v_profile.area_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Alerts: skip no_expires documents
-- ---------------------------------------------------------------------------

create or replace function public.sync_employee_expediente_alerts(p_profile_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_hr_ids uuid[];
  rec record;
  v_task_id text;
  v_priority text;
  v_title text;
  v_alert_id uuid;
begin
  if auth.uid() is not null and not public.can_read_employee_expedientes() then
    raise exception 'No tienes permiso para sincronizar alertas.';
  end if;

  select coalesce(array_agg(p.id), '{}'::uuid[])
  into v_hr_ids
  from public.profiles p
  where p.status = 'active'
    and public.normalize_profile_role(p.role) = 'recursos_humanos';

  for rec in
    select
      p.id as profile_id,
      p.full_name,
      v.id as version_id,
      ft.code as file_type_code,
      ft.label as file_type_label,
      v.expires_at,
      public.employee_file_expiry_status(v.expires_at, v.no_expires) as expiry_status
    from public.profiles p
    join public.employee_file_versions v on v.profile_id = p.id and v.is_current = true
    join public.employee_file_types ft on ft.code = v.file_type_code
    where p.status = 'active'
      and not coalesce(v.no_expires, false)
      and v.expires_at is not null
      and (p_profile_id is null or p.id = p_profile_id)
      and public.employee_file_expiry_status(v.expires_at, v.no_expires) in ('warning', 'orange', 'expired')
  loop
    v_priority := case rec.expiry_status
      when 'expired' then 'critical'
      when 'orange' then 'high'
      else 'medium'
    end;

    v_title := case rec.expiry_status
      when 'expired' then 'Renovar ' || lower(rec.file_type_label) || ' de ' || coalesce(rec.full_name, 'colaborador') || ' (vencido)'
      else 'Renovar ' || lower(rec.file_type_label) || ' de ' || coalesce(rec.full_name, 'colaborador')
    end;

    insert into public.employee_file_alerts (
      profile_id, file_type_code, version_id, alert_level, message
    )
    values (
      rec.profile_id,
      rec.file_type_code,
      rec.version_id,
      case rec.expiry_status when 'expired' then 'critical' when 'orange' then 'orange' else 'warning' end,
      v_title
    )
    on conflict (profile_id, file_type_code, alert_level, alert_date) do update set
      message = excluded.message,
      version_id = excluded.version_id
    returning id into v_alert_id;

    v_count := v_count + 1;

    v_task_id := 'expediente-' || rec.profile_id::text || '-' || rec.file_type_code || '-' || rec.expiry_status;

    insert into public.assigned_tasks (
      id, title, status, due_date, due_at, assigned_profile_ids, assigned_by, payload
    )
    values (
      v_task_id,
      v_title,
      'pending',
      coalesce(rec.expires_at, current_date),
      coalesce(rec.expires_at, current_date)::timestamptz,
      v_hr_ids,
      auth.uid(),
      jsonb_build_object(
        'source', 'employee_expediente',
        'profile_id', rec.profile_id,
        'file_type_code', rec.file_type_code,
        'priority', v_priority,
        'category', 'Recursos Humanos'
      )
    )
    on conflict (id) do update set
      title = excluded.title,
      due_date = excluded.due_date,
      due_at = excluded.due_at,
      payload = excluded.payload,
      updated_at = now();

    update public.employee_file_alerts
    set task_id = v_task_id
    where profile_id = rec.profile_id
      and file_type_code = rec.file_type_code
      and alert_date = current_date
      and resolved_at is null;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.update_employee_file_current(uuid, text, date, date, boolean, text, text) from public;
revoke all on function public.remove_employee_file_current(uuid, text) from public;
revoke all on function public.register_employee_file_version(uuid, text, text, text, text, bigint, date, date, boolean, text, text, jsonb) from public;

grant execute on function public.update_employee_file_current(uuid, text, date, date, boolean, text, text) to authenticated;
grant execute on function public.remove_employee_file_current(uuid, text) to authenticated;
grant execute on function public.register_employee_file_version(uuid, text, text, text, text, bigint, date, date, boolean, text, text, jsonb) to authenticated, service_role;
grant execute on function public.employee_file_expiry_status(date, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Profile status: respect no_expires on expiry detection
-- ---------------------------------------------------------------------------

create or replace function public.employee_expediente_status(p_profile_id uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_has_expired boolean;
  v_complete jsonb;
begin
  select exists (
    select 1
    from public.employee_file_versions v
    where v.profile_id = p_profile_id
      and v.is_current = true
      and not coalesce(v.no_expires, false)
      and v.expires_at is not null
      and v.expires_at < current_date
  ) into v_has_expired;

  if v_has_expired then
    return 'expired';
  end if;

  v_complete := public.employee_expediente_completeness(p_profile_id);
  if coalesce((v_complete ->> 'percent')::integer, 0) >= 100 then
    return 'complete';
  end if;
  return 'incomplete';
end;
$$;
