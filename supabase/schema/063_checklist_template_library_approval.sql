-- Checklist template library visibility and approval workflow hardening.
-- Apply after 062_fix_non_work_schedule_shifts.sql.

create or replace function public.is_checklist_library_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and status = 'active'
      and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'gerente', 'recursos_humanos', 'rrhh')
  );
$$;

create or replace function public.is_checklist_template_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and status = 'active'
      and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'gerente', 'recursos_humanos', 'rrhh')
  );
$$;

create or replace function public.is_checklist_change_approver()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.normalize_profile_role(public.current_profile_role()) in ('admin', 'gerente_general');
$$;

create or replace function public.can_read_checklist_template(p_template public.checklist_templates)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_checklist_library_admin()
    or (
      public.normalize_profile_role(public.current_profile_role()) = 'supervisor'
      and (
        p_template.status = 'active'
        or p_template.created_by = auth.uid()
      )
    );
$$;

drop policy if exists "checklist_templates_authorized_read" on public.checklist_templates;
create policy "checklist_templates_authorized_read"
  on public.checklist_templates for select to authenticated
  using (public.can_read_checklist_template(checklist_templates));

drop policy if exists "checklist_template_items_authorized_read" on public.checklist_template_items;
create policy "checklist_template_items_authorized_read"
  on public.checklist_template_items for select to authenticated
  using (
    exists (
      select 1
      from public.checklist_templates template
      where template.id = checklist_template_items.template_id
        and public.can_read_checklist_template(template)
    )
  );

drop policy if exists "checklist_change_requests_read" on public.checklist_template_change_requests;
create policy "checklist_change_requests_read"
  on public.checklist_template_change_requests for select to authenticated
  using (
    public.is_checklist_change_approver()
    or public.is_checklist_library_admin()
    or submitted_by = auth.uid()
  );

create or replace function public.submit_checklist_change_request(p_request_id uuid)
returns public.checklist_template_change_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text := public.normalize_profile_role(public.current_profile_role());
  request_row public.checklist_template_change_requests;
  actor_name text;
  notification_title text;
  notification_message text;
begin
  if actor_role not in ('admin', 'gerente_general', 'gerente', 'supervisor', 'recursos_humanos', 'rrhh') then
    raise exception 'No tienes permiso para enviar cambios de checklist.';
  end if;

  select * into request_row
  from public.checklist_template_change_requests
  where id = p_request_id
  for update;

  if request_row.id is null then
    raise exception 'Solicitud no encontrada.';
  end if;
  if request_row.submitted_by <> auth.uid() and not public.is_checklist_change_approver() then
    raise exception 'No tienes permiso para enviar esta solicitud.';
  end if;
  if request_row.status not in ('draft', 'rejected') then
    raise exception 'Solo se pueden enviar borradores o solicitudes rechazadas.';
  end if;
  if request_row.template_id is not null and exists (
    select 1
    from public.checklist_template_change_requests other
    where other.template_id = request_row.template_id
      and other.status = 'pending_review'
      and other.id <> request_row.id
  ) then
    raise exception 'Ya existe una solicitud pendiente para esta checklist.';
  end if;

  update public.checklist_template_change_requests
  set status = 'pending_review',
      submitted_by = coalesce(submitted_by, auth.uid()),
      submitted_at = now(),
      reviewed_by = null,
      reviewed_at = null,
      review_notes = null
  where id = p_request_id
  returning * into request_row;

  select coalesce(full_name, username, 'Colaborador') into actor_name
  from public.profiles
  where id = auth.uid();

  notification_title := case
    when request_row.request_type = 'create' then 'Nueva checklist pendiente de aprobacion'
    else 'Cambio de checklist pendiente de aprobacion'
  end;
  notification_message := coalesce(actor_name, 'Colaborador') || ' envio a verificacion: ' || request_row.title;

  insert into public.notifications (
    user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
  )
  select
    p.id,
    null,
    'checklist_approval',
    notification_title,
    notification_message,
    'checklist_template_change_request',
    request_row.id::text,
    '/tasks?tab=checklists&view=approvals&id=' || request_row.id::text,
    auth.uid()
  from public.profiles p
  where p.status = 'active'
    and public.normalize_profile_role(p.role) in ('admin', 'gerente_general')
    and not exists (
      select 1
      from public.notifications n
      where n.user_id = p.id
        and n.type = 'checklist_approval'
        and n.entity_type = 'checklist_template_change_request'
        and n.entity_id = request_row.id::text
    );

  return request_row;
end;
$$;

create or replace function public.get_checklist_templates_library()
returns table (
  id uuid,
  title text,
  description text,
  area text,
  assigned_role text,
  assigned_profile_id uuid,
  supervisor_profile_id uuid,
  backup_profile_id uuid,
  frequency text,
  shift_context text,
  status text,
  reminder_time time,
  due_time time,
  recurrence_days integer[],
  recurrence_month_day integer,
  recurrence_rule text,
  skip_non_work_days boolean,
  auto_generate boolean,
  requires_approval boolean,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  creator_name text,
  checklist_template_items jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.title,
    t.description,
    t.area,
    t.assigned_role,
    t.assigned_profile_id,
    t.supervisor_profile_id,
    t.backup_profile_id,
    t.frequency,
    t.shift_context,
    t.status,
    t.reminder_time,
    t.due_time,
    t.recurrence_days,
    t.recurrence_month_day,
    t.recurrence_rule,
    t.skip_non_work_days,
    t.auto_generate,
    t.requires_approval,
    t.created_by,
    t.created_at,
    t.updated_at,
    coalesce(p.full_name, p.username, 'Colaborador') as creator_name,
    coalesce(
      (
        select jsonb_agg(to_jsonb(item) order by item.item_order)
        from public.checklist_template_items item
        where item.template_id = t.id
          and item.is_active is distinct from false
      ),
      '[]'::jsonb
    ) as checklist_template_items
  from public.checklist_templates t
  left join public.profiles p on p.id = t.created_by
  where public.can_read_checklist_template(t)
  order by t.created_at desc;
$$;

revoke all on function
  public.is_checklist_library_admin(),
  public.can_read_checklist_template(public.checklist_templates),
  public.get_checklist_templates_library(),
  public.submit_checklist_change_request(uuid)
from public;

grant execute on function
  public.is_checklist_library_admin(),
  public.can_read_checklist_template(public.checklist_templates),
  public.get_checklist_templates_library(),
  public.submit_checklist_change_request(uuid)
to authenticated;
