-- Approval workflow for checklist template changes.
-- Apply after 031_checklist_template_delete_permissions.sql.

create table if not exists public.checklist_template_change_requests (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.checklist_templates(id) on delete set null,
  request_type text not null default 'update'
    check (request_type in ('create', 'update', 'archive', 'delete')),
  status text not null default 'draft'
    check (status in ('draft', 'pending_review', 'approved', 'rejected', 'cancelled')),
  title text not null,
  description text,
  area text,
  assigned_role text,
  assigned_profile_id uuid references public.profiles(id),
  frequency text,
  shift_context text,
  status_after_approval text not null default 'active',
  items_snapshot jsonb not null default '[]'::jsonb,
  submitted_by uuid references public.profiles(id) default auth.uid(),
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists checklist_change_requests_status_idx
  on public.checklist_template_change_requests (status, created_at desc);

create index if not exists checklist_change_requests_template_pending_idx
  on public.checklist_template_change_requests (template_id, status)
  where status = 'pending_review' and template_id is not null;

alter table public.checklist_template_change_requests enable row level security;

grant select, insert, update on public.checklist_template_change_requests to authenticated;
grant all on public.checklist_template_change_requests to service_role;

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
      and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'gerente')
  );
$$;

create or replace function public.is_checklist_change_approver()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.normalize_profile_role(public.current_profile_role()) in ('admin', 'gerente_general', 'gerente');
$$;

drop trigger if exists set_checklist_change_requests_updated_at on public.checklist_template_change_requests;
create trigger set_checklist_change_requests_updated_at
  before update on public.checklist_template_change_requests
  for each row execute procedure public.set_checklist_updated_at();

drop policy if exists "checklist_change_requests_read" on public.checklist_template_change_requests;
create policy "checklist_change_requests_read"
  on public.checklist_template_change_requests for select to authenticated
  using (
    public.is_checklist_change_approver()
    or submitted_by = auth.uid()
  );

drop policy if exists "checklist_change_requests_insert" on public.checklist_template_change_requests;
create policy "checklist_change_requests_insert"
  on public.checklist_template_change_requests for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and status = 'draft'
    and public.normalize_profile_role(public.current_profile_role()) in ('admin', 'gerente_general', 'gerente', 'supervisor')
  );

drop policy if exists "checklist_change_requests_update" on public.checklist_template_change_requests;
create policy "checklist_change_requests_update"
  on public.checklist_template_change_requests for update to authenticated
  using (
    public.is_checklist_change_approver()
    or (submitted_by = auth.uid() and status in ('draft', 'cancelled'))
  )
  with check (
    public.is_checklist_change_approver()
    or (submitted_by = auth.uid() and status in ('draft', 'cancelled'))
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
begin
  if actor_role not in ('admin', 'gerente_general', 'gerente', 'supervisor') then
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

  select coalesce(full_name, username, 'Supervisor') into actor_name
  from public.profiles
  where id = auth.uid();

  insert into public.notifications (
    user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
  )
  select
    p.id,
    null,
    'checklist_approval',
    'Checklist pendiente de aprobacion',
    coalesce(actor_name, 'Supervisor') || ' envio a verificacion: ' || request_row.title,
    'checklist_template_change_request',
    request_row.id::text,
    '/tasks?tab=checklists&view=approvals&id=' || request_row.id::text,
    auth.uid()
  from public.profiles p
  where p.status = 'active'
    and public.normalize_profile_role(p.role) in ('admin', 'gerente_general', 'gerente')
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

create or replace function public.approve_checklist_change_request(p_request_id uuid, p_review_notes text default null)
returns public.checklist_template_change_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.checklist_template_change_requests;
  v_template_id uuid;
begin
  if not public.is_checklist_change_approver() then
    raise exception 'No tienes permiso para aprobar cambios de checklist.';
  end if;

  select * into request_row
  from public.checklist_template_change_requests
  where id = p_request_id
  for update;

  if request_row.id is null then
    raise exception 'Solicitud no encontrada.';
  end if;
  if request_row.status <> 'pending_review' then
    raise exception 'Solo se pueden aprobar solicitudes pendientes.';
  end if;

  if request_row.request_type = 'create' then
    insert into public.checklist_templates (
      title, description, area, assigned_role, assigned_profile_id, frequency, shift_context, status, created_by
    )
    values (
      request_row.title, request_row.description, request_row.area, request_row.assigned_role,
      request_row.assigned_profile_id, coalesce(request_row.frequency, 'manual'),
      coalesce(request_row.shift_context, 'general'), coalesce(request_row.status_after_approval, 'active'),
      request_row.submitted_by
    )
    returning id into v_template_id;
  elsif request_row.request_type = 'update' then
    v_template_id := request_row.template_id;
    update public.checklist_templates
    set title = request_row.title,
        description = request_row.description,
        area = request_row.area,
        assigned_role = request_row.assigned_role,
        assigned_profile_id = request_row.assigned_profile_id,
        frequency = coalesce(request_row.frequency, 'manual'),
        shift_context = coalesce(request_row.shift_context, 'general'),
        status = coalesce(request_row.status_after_approval, 'active')
    where id = v_template_id;
    delete from public.checklist_template_items where checklist_template_items.template_id = v_template_id;
  elsif request_row.request_type = 'archive' then
    v_template_id := request_row.template_id;
    update public.checklist_templates set status = 'inactive' where id = v_template_id;
  elsif request_row.request_type = 'delete' then
    v_template_id := request_row.template_id;
    if exists (select 1 from public.checklist_runs where template_id = request_row.template_id) then
      update public.checklist_templates set status = 'inactive' where id = request_row.template_id;
    else
      delete from public.checklist_templates where id = request_row.template_id;
      v_template_id := null;
    end if;
  end if;

  if request_row.request_type in ('create', 'update') then
    insert into public.checklist_template_items (
      template_id, item_order, title, description, response_type, is_required,
      requires_photo, requires_comment, score_points
    )
    select
      v_template_id,
      coalesce((item.value ->> 'item_order')::integer, item.ordinality::integer - 1),
      item.value ->> 'title',
      nullif(item.value ->> 'description', ''),
      coalesce(nullif(item.value ->> 'response_type', ''), 'checkbox'),
      coalesce((item.value ->> 'is_required')::boolean, true),
      coalesce((item.value ->> 'requires_photo')::boolean, false),
      coalesce((item.value ->> 'requires_comment')::boolean, false),
      greatest(0, coalesce((item.value ->> 'score_points')::integer, 1))
    from jsonb_array_elements(request_row.items_snapshot) with ordinality as item(value, ordinality)
    where nullif(trim(item.value ->> 'title'), '') is not null;
  end if;

  update public.checklist_template_change_requests
  set status = 'approved',
      template_id = v_template_id,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = nullif(trim(coalesce(p_review_notes, '')), '')
  where id = p_request_id
  returning * into request_row;

  insert into public.notifications (
    user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
  )
  values (
    request_row.submitted_by,
    null,
    'checklist_approval_result',
    'Checklist aprobada',
    'Checklist aprobada y publicada: ' || request_row.title,
    'checklist_template_change_request',
    request_row.id::text,
    '/tasks?tab=checklists&view=approvals&id=' || request_row.id::text,
    auth.uid()
  );

  return request_row;
end;
$$;

create or replace function public.reject_checklist_change_request(p_request_id uuid, p_review_notes text)
returns public.checklist_template_change_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.checklist_template_change_requests;
begin
  if not public.is_checklist_change_approver() then
    raise exception 'No tienes permiso para rechazar cambios de checklist.';
  end if;
  if nullif(trim(coalesce(p_review_notes, '')), '') is null then
    raise exception 'La nota de rechazo es obligatoria.';
  end if;

  update public.checklist_template_change_requests
  set status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = trim(p_review_notes)
  where id = p_request_id
    and status = 'pending_review'
  returning * into request_row;

  if request_row.id is null then
    raise exception 'Solicitud pendiente no encontrada.';
  end if;

  insert into public.notifications (
    user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
  )
  values (
    request_row.submitted_by,
    null,
    'checklist_approval_result',
    'Checklist rechazada',
    'Solicitud rechazada: ' || request_row.title,
    'checklist_template_change_request',
    request_row.id::text,
    '/tasks?tab=checklists&view=approvals&id=' || request_row.id::text,
    auth.uid()
  );

  return request_row;
end;
$$;

revoke all on function
  public.is_checklist_change_approver(),
  public.submit_checklist_change_request(uuid),
  public.approve_checklist_change_request(uuid, text),
  public.reject_checklist_change_request(uuid, text)
from public;

grant execute on function
  public.is_checklist_change_approver(),
  public.submit_checklist_change_request(uuid),
  public.approve_checklist_change_request(uuid, text),
  public.reject_checklist_change_request(uuid, text)
to authenticated;
