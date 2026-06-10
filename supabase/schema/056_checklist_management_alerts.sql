-- Voluntary management alerts from checklist execution (no chat / no replies).
-- Apply after 055_checklist_template_items_soft_delete.sql.

create table if not exists public.checklist_management_alerts (
  id uuid primary key default gen_random_uuid(),
  checklist_run_id uuid not null references public.checklist_runs(id) on delete cascade,
  checklist_template_id uuid references public.checklist_templates(id) on delete set null,
  sender_profile_id uuid not null references public.profiles(id) on delete restrict,
  priority text not null default 'informativo'
    check (priority in ('informativo', 'atencion', 'critico')),
  message text not null check (char_length(trim(message)) >= 10 and char_length(message) <= 1000),
  status text not null default 'open'
    check (status in ('open', 'reviewed', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolution_notes text,
  updated_at timestamptz not null default now()
);

create index if not exists checklist_management_alerts_status_idx
  on public.checklist_management_alerts (status, priority, created_at desc);

create index if not exists checklist_management_alerts_run_idx
  on public.checklist_management_alerts (checklist_run_id, created_at desc);

alter table public.checklist_management_alerts enable row level security;

grant select on public.checklist_management_alerts to authenticated;
grant all on public.checklist_management_alerts to service_role;

drop trigger if exists set_checklist_management_alerts_updated_at on public.checklist_management_alerts;
create trigger set_checklist_management_alerts_updated_at
  before update on public.checklist_management_alerts
  for each row execute procedure public.set_checklist_updated_at();

create or replace function public.can_read_checklist_management_alert(p_alert public.checklist_management_alerts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.status = 'active'
      and (
        public.normalize_profile_role(profile.role) in ('admin', 'gerente_general')
        or p_alert.sender_profile_id = auth.uid()
      )
  );
$$;

create or replace function public.can_manage_checklist_management_alert()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.status = 'active'
      and public.normalize_profile_role(profile.role) in ('admin', 'gerente_general')
  );
$$;

drop policy if exists "checklist_management_alerts_read" on public.checklist_management_alerts;
create policy "checklist_management_alerts_read"
  on public.checklist_management_alerts for select to authenticated
  using (public.can_read_checklist_management_alert(checklist_management_alerts));

drop policy if exists "checklist_management_alerts_management_update" on public.checklist_management_alerts;
create policy "checklist_management_alerts_management_update"
  on public.checklist_management_alerts for update to authenticated
  using (public.can_manage_checklist_management_alert())
  with check (public.can_manage_checklist_management_alert());

create or replace function public.create_checklist_management_alert(
  p_checklist_run_id uuid,
  p_priority text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_record public.checklist_runs;
  template_record public.checklist_templates;
  sender_record public.profiles;
  alert_record public.checklist_management_alerts;
  trimmed_message text;
  normalized_priority text;
  sender_name text;
  template_title text;
  notification_warning text := null;
  role_value text;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion para enviar un aviso.';
  end if;

  trimmed_message := trim(coalesce(p_message, ''));
  if char_length(trimmed_message) < 10 then
    raise exception 'El aviso debe tener al menos 10 caracteres.';
  end if;
  if char_length(trimmed_message) > 1000 then
    raise exception 'El aviso no puede superar 1000 caracteres.';
  end if;

  normalized_priority := lower(trim(coalesce(p_priority, 'informativo')));
  if normalized_priority not in ('informativo', 'atencion', 'critico') then
    raise exception 'Prioridad de aviso no valida.';
  end if;

  select * into run_record
  from public.checklist_runs
  where id = p_checklist_run_id;

  if run_record.id is null then
    raise exception 'La checklist asignada no existe.';
  end if;

  if not public.can_access_checklist_run(run_record) then
    raise exception 'No tienes permiso para enviar avisos en esta checklist.';
  end if;

  if run_record.status = 'cancelled' then
    raise exception 'No se pueden enviar avisos en checklists canceladas.';
  end if;

  select * into template_record
  from public.checklist_templates
  where id = run_record.template_id;

  select * into sender_record
  from public.profiles
  where id = auth.uid()
    and status = 'active';

  if sender_record.id is null then
    raise exception 'Perfil de usuario no valido.';
  end if;

  insert into public.checklist_management_alerts (
    checklist_run_id,
    checklist_template_id,
    sender_profile_id,
    priority,
    message,
    status
  )
  values (
    run_record.id,
    run_record.template_id,
    auth.uid(),
    normalized_priority,
    trimmed_message,
    'open'
  )
  returning * into alert_record;

  sender_name := coalesce(nullif(trim(sender_record.full_name), ''), nullif(trim(sender_record.username), ''), 'Colaborador');
  template_title := coalesce(nullif(trim(template_record.title), ''), 'Checklist');

  begin
    foreach role_value in array array['admin', 'gerente_general']
    loop
      insert into public.notifications (
        user_id,
        target_role,
        type,
        title,
        message,
        entity_type,
        entity_id,
        action_url,
        created_by
      )
      values (
        null,
        role_value,
        'checklist_management_alert',
        'Aviso desde checklist',
        sender_name || ' reporto un aviso en ' || template_title || '.',
        'checklist_management_alert',
        alert_record.id::text,
        '/tasks?tab=checklists&view=run&id=' || run_record.id::text,
        auth.uid()
      );
    end loop;
  exception
    when others then
      notification_warning := 'El aviso se guardo, pero no se pudieron crear todas las notificaciones.';
  end;

  return jsonb_build_object(
    'alert', to_jsonb(alert_record),
    'notification_warning', notification_warning
  );
end;
$$;

create or replace function public.update_checklist_management_alert_status(
  p_alert_id uuid,
  p_status text,
  p_resolution_notes text default null
)
returns public.checklist_management_alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  alert_record public.checklist_management_alerts;
  normalized_status text;
begin
  if not public.can_manage_checklist_management_alert() then
    raise exception 'No tienes permiso para actualizar avisos a gerencia.';
  end if;

  normalized_status := lower(trim(coalesce(p_status, '')));
  if normalized_status not in ('open', 'reviewed', 'resolved', 'dismissed') then
    raise exception 'Estado de aviso no valido.';
  end if;

  select * into alert_record
  from public.checklist_management_alerts
  where id = p_alert_id
  for update;

  if alert_record.id is null then
    raise exception 'El aviso no existe.';
  end if;

  update public.checklist_management_alerts
  set
    status = normalized_status,
    resolution_notes = coalesce(nullif(trim(p_resolution_notes), ''), resolution_notes),
    resolved_by = case when normalized_status in ('resolved', 'dismissed') then auth.uid() else resolved_by end,
    resolved_at = case when normalized_status in ('resolved', 'dismissed') then now() else null end,
    updated_at = now()
  where id = p_alert_id
  returning * into alert_record;

  return alert_record;
end;
$$;

revoke all on function
  public.can_read_checklist_management_alert(public.checklist_management_alerts),
  public.can_manage_checklist_management_alert(),
  public.create_checklist_management_alert(uuid, text, text),
  public.update_checklist_management_alert_status(uuid, text, text)
from public;

grant execute on function
  public.can_read_checklist_management_alert(public.checklist_management_alerts),
  public.can_manage_checklist_management_alert(),
  public.create_checklist_management_alert(uuid, text, text),
  public.update_checklist_management_alert_status(uuid, text, text)
to authenticated;
