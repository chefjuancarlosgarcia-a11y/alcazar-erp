-- Catering CRM Sprint 1: activity log, SLA metrics, weighted pipeline, reminders, notifications.
-- Apply after 085_notifications_read_rpc.sql.

-- ---------------------------------------------------------------------------
-- Commercial fields
-- ---------------------------------------------------------------------------

alter table public.catering_requests
  add column if not exists win_probability integer
    check (win_probability is null or (win_probability >= 0 and win_probability <= 100));

comment on column public.catering_requests.win_probability is
  'Close probability 0-100 for weighted pipeline value.';

-- ---------------------------------------------------------------------------
-- Activity log
-- ---------------------------------------------------------------------------

create table if not exists public.catering_activity_log (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.catering_requests(id) on delete cascade,
  activity_type text not null check (activity_type in (
    'lead_received',
    'lead_assigned',
    'status_changed',
    'followup_recorded',
    'contact_made'
  )),
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists catering_activity_log_request_idx
  on public.catering_activity_log (request_id, created_at desc);

alter table public.catering_activity_log enable row level security;

grant select, insert on public.catering_activity_log to authenticated;
grant all on public.catering_activity_log to service_role;

drop policy if exists "catering_activity_log_select" on public.catering_activity_log;
create policy "catering_activity_log_select"
  on public.catering_activity_log
  for select
  to authenticated
  using (public.can_manage_catering_requests());

drop policy if exists "catering_activity_log_insert" on public.catering_activity_log;
create policy "catering_activity_log_insert"
  on public.catering_activity_log
  for insert
  to authenticated
  with check (public.can_manage_catering_requests());

-- ---------------------------------------------------------------------------
-- Permissions (include ventas)
-- ---------------------------------------------------------------------------

create or replace function public.can_manage_catering_requests()
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
      and public.normalize_profile_role(profile.role) in (
        'admin',
        'gerente_general',
        'gerente',
        'gerente_operaciones',
        'supervisor',
        'ventas'
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.catering_default_win_probability(p_conversion_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case nullif(trim(coalesce(p_conversion_status, '')), '')
    when 'lead' then 10
    when 'contacted' then 25
    when 'quoted' then 50
    when 'negotiating' then 75
    when 'approved' then 100
    when 'converted' then 100
    else 10
  end;
$$;

create or replace function public.catering_effective_win_probability(
  p_win_probability integer,
  p_conversion_status text
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_win_probability,
    public.catering_default_win_probability(p_conversion_status)
  );
$$;

create or replace function public.log_catering_activity(
  p_request_id uuid,
  p_activity_type text,
  p_description text,
  p_metadata jsonb default '{}'::jsonb,
  p_created_by uuid default null,
  p_created_at timestamptz default null
)
returns public.catering_activity_log
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.catering_activity_log;
begin
  if p_request_id is null or nullif(trim(coalesce(p_description, '')), '') is null then
    raise exception 'request_id y description son obligatorios para activity log.';
  end if;

  insert into public.catering_activity_log (
    request_id,
    activity_type,
    description,
    metadata,
    created_by,
    created_at
  )
  values (
    p_request_id,
    p_activity_type,
    trim(p_description),
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_created_by, auth.uid()),
    coalesce(p_created_at, now())
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.notify_catering_lead_assigned(
  p_request_id uuid,
  p_assigned_to uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.catering_requests;
  v_action_url text;
  v_inserted integer := 0;
begin
  if p_request_id is null or p_assigned_to is null then
    return 0;
  end if;

  select * into v_request from public.catering_requests where id = p_request_id;
  if not found then
    return 0;
  end if;

  v_action_url := '/catering?id=' || v_request.id::text;

  insert into public.notifications (
    user_id,
    target_role,
    type,
    title,
    message,
    entity_type,
    entity_id,
    action_url
  )
  select
    p_assigned_to,
    null,
    'catering_lead_assigned',
    'Lead de catering asignado',
    coalesce(nullif(trim(v_request.customer_name), ''), 'Cliente')
      || ' te fue asignado para seguimiento comercial.',
    'catering_request',
    v_request.id::text,
    v_action_url
  where not exists (
    select 1
    from public.notifications n
    where n.user_id = p_assigned_to
      and n.type = 'catering_lead_assigned'
      and n.entity_type = 'catering_request'
      and n.entity_id = v_request.id::text
      and n.created_at > now() - interval '1 hour'
  );

  get diagnostics v_inserted = row_count;
  return v_inserted;
exception
  when others then
    raise warning 'notify_catering_lead_assigned failed for %: %', p_request_id, sqlerrm;
    return 0;
end;
$$;

create or replace function public.sync_catering_followup_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  if auth.uid() is null then
    return 0;
  end if;

  with due_requests as (
    select
      request.id,
      request.customer_name,
      request.follow_up_date,
      request.assigned_to,
      case
        when request.follow_up_date < current_date then 'overdue'
        when request.follow_up_date = current_date then 'today'
        else 'upcoming'
      end as urgency
    from public.catering_requests request
    where request.follow_up_date is not null
      and request.follow_up_date <= current_date
      and request.conversion_status not in ('approved', 'lost', 'converted')
  ),
  recipients as (
    select
      due.id as request_id,
      due.customer_name,
      due.follow_up_date,
      due.urgency,
      coalesce(due.assigned_to, profile.id) as user_id
    from due_requests due
    cross join lateral (
      select p.id
      from public.profiles p
      where p.status = 'active'
        and (
          p.id = due.assigned_to
          or (
            due.assigned_to is null
            and public.normalize_profile_role(p.role) = any(public.catering_request_notification_roles())
          )
        )
    ) profile
  ),
  inserted as (
    insert into public.notifications (
      user_id,
      target_role,
      type,
      title,
      message,
      entity_type,
      entity_id,
      action_url
    )
    select
      recipients.user_id,
      null,
      'catering_followup_due',
      case recipients.urgency
        when 'overdue' then 'Seguimiento de catering vencido'
        else 'Seguimiento de catering hoy'
      end,
      coalesce(nullif(trim(recipients.customer_name), ''), 'Cliente')
        || case recipients.urgency
          when 'overdue' then ' — seguimiento vencido desde '
          else ' — seguimiento programado para hoy ('
        end
        || to_char(recipients.follow_up_date, 'DD/MM/YYYY')
        || case when recipients.urgency = 'today' then ')' else '' end,
      'catering_request',
      recipients.request_id::text,
      '/catering?id=' || recipients.request_id::text
    from recipients
    where not exists (
      select 1
      from public.notifications n
      where n.user_id = recipients.user_id
        and n.type = 'catering_followup_due'
        and n.entity_type = 'catering_request'
        and n.entity_id = recipients.request_id::text
        and n.created_at::date = current_date
    )
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
exception
  when others then
    raise warning 'sync_catering_followup_reminders failed: %', sqlerrm;
    return 0;
end;
$$;

-- Backfill lead_received for existing requests
insert into public.catering_activity_log (request_id, activity_type, description, created_by, created_at)
select
  request.id,
  'lead_received',
  'Lead recibido',
  request.created_by,
  request.created_at
from public.catering_requests request
where not exists (
  select 1
  from public.catering_activity_log log
  where log.request_id = request.id
    and log.activity_type = 'lead_received'
);

-- ---------------------------------------------------------------------------
-- RPC: create_catering_request (activity log)
-- ---------------------------------------------------------------------------

create or replace function public.create_catering_request(p_data jsonb)
returns public.catering_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_name text := nullif(trim(coalesce(p_data ->> 'customer_name', '')), '');
  v_source text := coalesce(nullif(trim(coalesce(p_data ->> 'source', '')), ''), 'wix_form');
  v_row public.catering_requests;
begin
  if auth.uid() is not null and not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para crear solicitudes de catering.';
  end if;

  if v_customer_name is null then
    raise exception 'customer_name es obligatorio.';
  end if;

  insert into public.catering_requests (
    customer_name,
    customer_phone,
    customer_email,
    event_date,
    event_time,
    event_location,
    event_type,
    guest_count,
    products_requested,
    notes,
    status,
    source,
    lead_source,
    assigned_to,
    follow_up_date,
    estimated_value,
    win_probability,
    conversion_status,
    created_by,
    updated_by
  )
  values (
    v_customer_name,
    nullif(trim(coalesce(p_data ->> 'customer_phone', '')), ''),
    nullif(trim(coalesce(p_data ->> 'customer_email', '')), ''),
    nullif(p_data ->> 'event_date', '')::date,
    nullif(p_data ->> 'event_time', '')::time,
    nullif(trim(coalesce(p_data ->> 'event_location', '')), ''),
    nullif(trim(coalesce(p_data ->> 'event_type', '')), ''),
    nullif(p_data ->> 'guest_count', '')::integer,
    coalesce(
      (
        select array_agg(value)
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(p_data -> 'products_requested') = 'array' then p_data -> 'products_requested'
            else '[]'::jsonb
          end
        ) as value
        where nullif(trim(value), '') is not null
      ),
      '{}'::text[]
    ),
    nullif(trim(coalesce(p_data ->> 'notes', '')), ''),
    'new',
    v_source,
    'website',
    nullif(p_data ->> 'assigned_to', '')::uuid,
    nullif(p_data ->> 'follow_up_date', '')::date,
    nullif(p_data ->> 'estimated_value', '')::numeric(12, 2),
    nullif(p_data ->> 'win_probability', '')::integer,
    'lead',
    auth.uid(),
    auth.uid()
  )
  returning * into v_row;

  perform public.log_catering_activity(
    v_row.id,
    'lead_received',
    'Lead recibido',
    jsonb_build_object('source', v_row.source, 'lead_source', v_row.lead_source),
    v_row.created_by,
    v_row.created_at
  );
  perform public.notify_new_catering_request(v_row.id);

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: assign_catering_lead (activity + notification)
-- ---------------------------------------------------------------------------

create or replace function public.assign_catering_lead(
  p_request_id uuid,
  p_assigned_to uuid
)
returns public.catering_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.catering_requests;
  v_assignee_name text;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para asignar leads de catering.';
  end if;

  if p_request_id is null or p_assigned_to is null then
    raise exception 'p_request_id y p_assigned_to son obligatorios.';
  end if;

  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_assigned_to and profile.status = 'active'
  ) then
    raise exception 'El responsable asignado no existe o no esta activo.';
  end if;

  select coalesce(nullif(trim(profile.full_name), ''), profile.username, 'Colaborador')
  into v_assignee_name
  from public.profiles profile
  where profile.id = p_assigned_to;

  update public.catering_requests request
  set
    assigned_to = p_assigned_to,
    updated_by = auth.uid()
  where request.id = p_request_id
  returning * into v_row;

  if not found then
    raise exception 'Solicitud de catering no encontrada.';
  end if;

  perform public.log_catering_activity(
    v_row.id,
    'lead_assigned',
    'Asignado a ' || v_assignee_name,
    jsonb_build_object('assigned_to', p_assigned_to, 'assignee_name', v_assignee_name)
  );
  perform public.notify_catering_lead_assigned(v_row.id, p_assigned_to);

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: update_catering_request_status (activity)
-- ---------------------------------------------------------------------------

create or replace function public.update_catering_request_status(
  p_request_id uuid,
  p_status text,
  p_notes text default null
)
returns public.catering_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_mapped_conversion text;
  v_previous_status text;
  v_row public.catering_requests;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para actualizar solicitudes de catering.';
  end if;

  if p_request_id is null or v_status is null then
    raise exception 'p_request_id y p_status son obligatorios.';
  end if;

  if not public.is_valid_catering_operational_status(v_status) then
    raise exception 'status operativo invalido: %', v_status;
  end if;

  select request.status
  into v_previous_status
  from public.catering_requests request
  where request.id = p_request_id;

  v_mapped_conversion := public.map_catering_status_to_conversion(v_status);

  update public.catering_requests request
  set
    status = v_status,
    conversion_status = coalesce(v_mapped_conversion, request.conversion_status),
    notes = case
      when p_notes is null then request.notes
      when nullif(trim(p_notes), '') is null then request.notes
      when nullif(trim(coalesce(request.notes, '')), '') is null then trim(p_notes)
      else request.notes || E'\n' || trim(p_notes)
    end,
    updated_by = auth.uid()
  where request.id = p_request_id
  returning * into v_row;

  if not found then
    raise exception 'Solicitud de catering no encontrada.';
  end if;

  if v_previous_status is distinct from v_status then
    perform public.log_catering_activity(
      v_row.id,
      'status_changed',
      'Estado operativo: ' || coalesce(v_previous_status, '—') || ' → ' || v_status,
      jsonb_build_object(
        'previous_status', v_previous_status,
        'new_status', v_status,
        'conversion_status', v_row.conversion_status
      )
    );
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: update_catering_followup (activity + win_probability)
-- ---------------------------------------------------------------------------

drop function if exists public.update_catering_followup(uuid, date, text, text, numeric);

create or replace function public.update_catering_followup(
  p_request_id uuid,
  p_follow_up_date date default null,
  p_notes text default null,
  p_conversion_status text default null,
  p_estimated_value numeric default null,
  p_win_probability integer default null
)
returns public.catering_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversion_status text := nullif(trim(coalesce(p_conversion_status, '')), '');
  v_previous_conversion text;
  v_row public.catering_requests;
  v_description text := 'Seguimiento registrado';
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para registrar seguimiento de catering.';
  end if;

  if p_request_id is null then
    raise exception 'p_request_id es obligatorio.';
  end if;

  if v_conversion_status is not null and not public.is_valid_catering_conversion_status(v_conversion_status) then
    raise exception 'conversion_status invalido: %', v_conversion_status;
  end if;

  if p_estimated_value is not null and p_estimated_value < 0 then
    raise exception 'estimated_value no puede ser negativo.';
  end if;

  if p_win_probability is not null and (p_win_probability < 0 or p_win_probability > 100) then
    raise exception 'win_probability debe estar entre 0 y 100.';
  end if;

  select request.conversion_status
  into v_previous_conversion
  from public.catering_requests request
  where request.id = p_request_id;

  update public.catering_requests request
  set
    follow_up_date = coalesce(p_follow_up_date, request.follow_up_date),
    last_contact_at = now(),
    conversion_status = coalesce(v_conversion_status, request.conversion_status),
    estimated_value = coalesce(p_estimated_value, request.estimated_value),
    win_probability = coalesce(p_win_probability, request.win_probability),
    notes = case
      when p_notes is null then request.notes
      when nullif(trim(p_notes), '') is null then request.notes
      when nullif(trim(coalesce(request.notes, '')), '') is null then trim(p_notes)
      else request.notes || E'\n' || trim(p_notes)
    end,
    updated_by = auth.uid()
  where request.id = p_request_id
  returning * into v_row;

  if not found then
    raise exception 'Solicitud de catering no encontrada.';
  end if;

  if v_previous_conversion is distinct from v_row.conversion_status then
    perform public.log_catering_activity(
      v_row.id,
      'status_changed',
      'Estado comercial: ' || coalesce(v_previous_conversion, '—') || ' → ' || v_row.conversion_status,
      jsonb_build_object(
        'previous_conversion_status', v_previous_conversion,
        'new_conversion_status', v_row.conversion_status
      )
    );
    v_description := 'Cliente contactado';
    perform public.log_catering_activity(
      v_row.id,
      'contact_made',
      v_description,
      jsonb_build_object('conversion_status', v_row.conversion_status)
    );
  else
    perform public.log_catering_activity(
      v_row.id,
      'followup_recorded',
      v_description,
      jsonb_build_object(
        'follow_up_date', v_row.follow_up_date,
        'notes', nullif(trim(coalesce(p_notes, '')), '')
      )
    );
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: get_catering_pipeline_summary (CRM dashboard KPIs)
-- ---------------------------------------------------------------------------

create or replace function public.get_catering_pipeline_summary(
  p_date_from date default null,
  p_date_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := coalesce(p_date_from, date_trunc('month', current_date)::date);
  v_to date := coalesce(p_date_to, current_date);
  v_total_leads bigint := 0;
  v_new_leads bigint := 0;
  v_new_leads_today bigint := 0;
  v_uncontacted_leads bigint := 0;
  v_contacted_leads bigint := 0;
  v_quoted_leads bigint := 0;
  v_negotiating_leads bigint := 0;
  v_approved_leads bigint := 0;
  v_lost_leads bigint := 0;
  v_converted_leads bigint := 0;
  v_gross_pipeline_value numeric(12, 2) := 0;
  v_weighted_pipeline_value numeric(12, 2) := 0;
  v_approved_total_value numeric(12, 2) := 0;
  v_conversion_rate numeric(10, 2) := 0;
  v_avg_response_time_minutes numeric(10, 2) := 0;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion para consultar el pipeline de catering.';
  end if;

  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para consultar el pipeline de catering.';
  end if;

  if v_to < v_from then
    raise exception 'p_date_to no puede ser menor que p_date_from.';
  end if;

  select
    count(*),
    count(*) filter (where conversion_status = 'lead'),
    count(*) filter (where created_at::date = current_date),
    count(*) filter (
      where conversion_status = 'lead'
        and last_contact_at is null
    ),
    count(*) filter (where conversion_status = 'contacted'),
    count(*) filter (where conversion_status = 'quoted'),
    count(*) filter (where conversion_status = 'negotiating'),
    count(*) filter (where conversion_status = 'approved'),
    count(*) filter (where conversion_status = 'lost'),
    count(*) filter (where conversion_status = 'converted'),
    coalesce(sum(estimated_value) filter (
      where conversion_status in ('lead', 'contacted', 'quoted', 'negotiating')
    ), 0),
    coalesce(sum(
      coalesce(estimated_value, 0)
      * public.catering_effective_win_probability(win_probability, conversion_status)::numeric
      / 100
    ) filter (
      where conversion_status in ('lead', 'contacted', 'quoted', 'negotiating')
    ), 0),
    coalesce(sum(estimated_value) filter (
      where conversion_status = 'approved'
    ), 0),
    coalesce(avg(extract(epoch from (last_contact_at - created_at)) / 60.0) filter (
      where last_contact_at is not null
    ), 0)
  into
    v_total_leads,
    v_new_leads,
    v_new_leads_today,
    v_uncontacted_leads,
    v_contacted_leads,
    v_quoted_leads,
    v_negotiating_leads,
    v_approved_leads,
    v_lost_leads,
    v_converted_leads,
    v_gross_pipeline_value,
    v_weighted_pipeline_value,
    v_approved_total_value,
    v_avg_response_time_minutes
  from public.catering_requests
  where created_at::date between v_from and v_to;

  if v_total_leads > 0 then
    v_conversion_rate := round((v_approved_leads::numeric / v_total_leads::numeric) * 100, 2);
  end if;

  return jsonb_build_object(
    'date_from', v_from,
    'date_to', v_to,
    'total_leads', v_total_leads,
    'new_leads', v_new_leads,
    'new_leads_today', v_new_leads_today,
    'uncontacted_leads', v_uncontacted_leads,
    'contacted_leads', v_contacted_leads,
    'quoted_leads', v_quoted_leads,
    'negotiating_leads', v_negotiating_leads,
    'approved_leads', v_approved_leads,
    'lost_leads', v_lost_leads,
    'converted_leads', v_converted_leads,
    'total_potential_value', v_gross_pipeline_value,
    'gross_pipeline_value', v_gross_pipeline_value,
    'weighted_pipeline_value', round(v_weighted_pipeline_value, 2),
    'approved_total_value', v_approved_total_value,
    'conversion_rate', v_conversion_rate,
    'avg_response_time_minutes', round(coalesce(v_avg_response_time_minutes, 0), 1)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: get_catering_activity_log
-- ---------------------------------------------------------------------------

create or replace function public.get_catering_activity_log(p_request_id uuid)
returns setof public.catering_activity_log
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para consultar actividad de catering.';
  end if;

  if p_request_id is null then
    raise exception 'p_request_id es obligatorio.';
  end if;

  return query
  select log.*
  from public.catering_activity_log log
  where log.request_id = p_request_id
  order by log.created_at desc, log.id desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: get_catering_assignee_ranking
-- ---------------------------------------------------------------------------

create or replace function public.get_catering_assignee_ranking(
  p_date_from date default null,
  p_date_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := coalesce(p_date_from, date_trunc('month', current_date)::date);
  v_to date := coalesce(p_date_to, current_date);
  v_rows jsonb := '[]'::jsonb;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para consultar ranking de catering.';
  end if;

  select coalesce(jsonb_agg(row_data order by active_leads desc, closed_leads desc), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'assignee_id', profile.id,
      'assignee_name', coalesce(nullif(trim(profile.full_name), ''), profile.username, 'Sin nombre'),
      'role', profile.role,
      'active_leads', count(*) filter (
        where request.conversion_status in ('lead', 'contacted', 'quoted', 'negotiating')
      ),
      'closed_leads', count(*) filter (
        where request.conversion_status in ('approved', 'lost', 'converted')
      ),
      'approved_leads', count(*) filter (where request.conversion_status = 'approved'),
      'conversion_rate', case
        when count(*) filter (where request.conversion_status in ('approved', 'lost', 'converted')) > 0 then
          round(
            (
              count(*) filter (where request.conversion_status = 'approved')::numeric
              / count(*) filter (where request.conversion_status in ('approved', 'lost', 'converted'))::numeric
            ) * 100,
            1
          )
        else 0
      end
    ) as row_data,
    count(*) filter (
      where request.conversion_status in ('lead', 'contacted', 'quoted', 'negotiating')
    ) as active_leads,
    count(*) filter (
      where request.conversion_status in ('approved', 'lost', 'converted')
    ) as closed_leads
    from public.profiles profile
    left join public.catering_requests request
      on request.assigned_to = profile.id
      and request.created_at::date between v_from and v_to
    where profile.status = 'active'
      and public.normalize_profile_role(profile.role) in (
        'admin',
        'gerente_general',
        'gerente',
        'gerente_operaciones',
        'supervisor',
        'ventas'
      )
    group by profile.id, profile.full_name, profile.username, profile.role
    having count(request.id) > 0
  ) ranked;

  return jsonb_build_object(
    'date_from', v_from,
    'date_to', v_to,
    'rows', v_rows
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: get_catering_pending_followups
-- ---------------------------------------------------------------------------

create or replace function public.get_catering_pending_followups()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb := '[]'::jsonb;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para consultar seguimientos de catering.';
  end if;

  select coalesce(jsonb_agg(row_data order by sort_key asc, follow_up_date asc), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'id', request.id,
      'customer_name', request.customer_name,
      'follow_up_date', request.follow_up_date,
      'conversion_status', request.conversion_status,
      'assigned_to', request.assigned_to,
      'urgency', case
        when request.follow_up_date < current_date then 'overdue'
        when request.follow_up_date = current_date then 'today'
        else 'upcoming'
      end
    ) as row_data,
    case
      when request.follow_up_date < current_date then 0
      when request.follow_up_date = current_date then 1
      else 2
    end as sort_key,
    request.follow_up_date
    from public.catering_requests request
    where request.follow_up_date is not null
      and request.follow_up_date <= current_date
      and request.conversion_status not in ('approved', 'lost', 'converted')
  ) pending;

  return jsonb_build_object('rows', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.catering_default_win_probability(text) from public;
revoke all on function public.catering_effective_win_probability(integer, text) from public;
revoke all on function public.log_catering_activity(uuid, text, text, jsonb, uuid, timestamptz) from public;
revoke all on function public.notify_catering_lead_assigned(uuid, uuid) from public;
revoke all on function public.sync_catering_followup_reminders() from public;
revoke all on function public.get_catering_activity_log(uuid) from public;
revoke all on function public.get_catering_assignee_ranking(date, date) from public;
revoke all on function public.get_catering_pending_followups() from public;

grant execute on function public.catering_default_win_probability(text) to authenticated;
grant execute on function public.catering_effective_win_probability(integer, text) to authenticated;
grant execute on function public.log_catering_activity(uuid, text, text, jsonb, uuid, timestamptz) to authenticated;
grant execute on function public.notify_catering_lead_assigned(uuid, uuid) to authenticated;
grant execute on function public.sync_catering_followup_reminders() to authenticated;
grant execute on function public.get_catering_activity_log(uuid) to authenticated;
grant execute on function public.get_catering_assignee_ranking(date, date) to authenticated;
grant execute on function public.get_catering_pending_followups() to authenticated;

grant execute on function public.create_catering_request(jsonb) to authenticated, service_role;
grant execute on function public.update_catering_request_status(uuid, text, text) to authenticated;
grant execute on function public.assign_catering_lead(uuid, uuid) to authenticated;
grant execute on function public.update_catering_followup(uuid, date, text, text, numeric, integer) to authenticated;
grant execute on function public.get_catering_pipeline_summary(date, date) to authenticated;
