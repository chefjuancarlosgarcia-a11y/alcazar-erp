-- 182a: Work center schema — apply after 181c.
-- Plan de trabajo, adjuntos, comentarios, evidencias, recordatorios, recurrencia.

-- ---------------------------------------------------------------------------
-- assigned_tasks extensions (F1.5 + F5)
-- ---------------------------------------------------------------------------
alter table public.assigned_tasks
  add column if not exists waiting_unblock_note text,
  add column if not exists waiting_since timestamptz,
  add column if not exists planned_start_at timestamptz;

alter table public.assigned_tasks
  drop constraint if exists assigned_tasks_status_check;

alter table public.assigned_tasks
  add constraint assigned_tasks_status_check
  check (status in (
    'pending', 'in_progress', 'waiting', 'blocked', 'in_review',
    'completed', 'cancelled', 'review_required'
  ));

-- Backfill waiting_since for existing waiting/blocked tasks
update public.assigned_tasks
set waiting_since = coalesce(waiting_since, updated_at)
where task_source = 'operational'
  and status in ('waiting', 'blocked')
  and waiting_since is null;

-- Migrate next_action used as unblock note into waiting_unblock_note
update public.assigned_tasks
set waiting_unblock_note = next_action
where task_source = 'operational'
  and status in ('waiting', 'blocked')
  and coalesce(trim(waiting_unblock_note), '') = ''
  and coalesce(trim(next_action), '') <> '';

-- ---------------------------------------------------------------------------
-- Plan de trabajo (F2)
-- ---------------------------------------------------------------------------
create table if not exists public.task_step_lists (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references public.assigned_tasks(id) on delete cascade,
  title text not null default 'Plan de trabajo',
  sort_position numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null
);

create index if not exists task_step_lists_task_idx
  on public.task_step_lists (task_id, sort_position)
  where deleted_at is null;

create table if not exists public.task_steps (
  id uuid primary key default gen_random_uuid(),
  step_list_id uuid not null references public.task_step_lists(id) on delete cascade,
  task_id text not null references public.assigned_tasks(id) on delete cascade,
  text text not null,
  completed boolean not null default false,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  assigned_profile_id uuid references public.profiles(id) on delete set null,
  due_at timestamptz,
  sort_position numeric not null default 0,
  depends_on_step_id uuid references public.task_steps(id) on delete set null,
  converted_task_id text references public.assigned_tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null
);

create index if not exists task_steps_list_idx
  on public.task_steps (step_list_id, sort_position)
  where deleted_at is null;

create index if not exists task_steps_task_idx
  on public.task_steps (task_id)
  where deleted_at is null;

create index if not exists task_steps_depends_idx
  on public.task_steps (depends_on_step_id)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Adjuntos (F3)
-- ---------------------------------------------------------------------------
create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references public.assigned_tasks(id) on delete cascade,
  step_id uuid references public.task_steps(id) on delete set null,
  attachment_type text not null default 'file'
    check (attachment_type in ('file', 'external_link')),
  storage_path text,
  external_url text,
  display_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists task_attachments_task_idx
  on public.task_attachments (task_id, uploaded_at desc)
  where deleted_at is null;

create index if not exists task_attachments_step_idx
  on public.task_attachments (step_id)
  where deleted_at is null and step_id is not null;

-- ---------------------------------------------------------------------------
-- Comentarios (F4)
-- ---------------------------------------------------------------------------
create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references public.assigned_tasks(id) on delete cascade,
  step_id uuid references public.task_steps(id) on delete set null,
  parent_comment_id uuid references public.task_comments(id) on delete set null,
  body_markdown text not null,
  mention_profile_ids uuid[] not null default '{}'::uuid[],
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists task_comments_task_idx
  on public.task_comments (task_id, created_at desc)
  where deleted_at is null;

create index if not exists task_comments_step_idx
  on public.task_comments (step_id, created_at desc)
  where deleted_at is null and step_id is not null;

-- ---------------------------------------------------------------------------
-- Evidencias (F6)
-- ---------------------------------------------------------------------------
create table if not exists public.task_evidence (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references public.assigned_tasks(id) on delete cascade,
  step_id uuid references public.task_steps(id) on delete set null,
  evidence_type text not null default 'photo'
    check (evidence_type in ('photo', 'document', 'video', 'note', 'link')),
  storage_path text,
  external_url text,
  display_name text not null,
  mime_type text,
  size_bytes bigint,
  note_text text,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz not null default now(),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists task_evidence_task_idx
  on public.task_evidence (task_id, submitted_at desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Recordatorios (F5)
-- ---------------------------------------------------------------------------
create table if not exists public.task_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references public.assigned_tasks(id) on delete cascade,
  step_id uuid references public.task_steps(id) on delete set null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  reminder_at timestamptz not null,
  delivered_at timestamptz,
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'sent', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists task_reminder_pending_idx
  on public.task_reminder_deliveries (reminder_at)
  where delivery_status = 'pending';

-- ---------------------------------------------------------------------------
-- Recurrencia (F8)
-- ---------------------------------------------------------------------------
create table if not exists public.task_recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  source_task_id text not null references public.assigned_tasks(id) on delete cascade,
  frequency text not null default 'weekly'
    check (frequency in ('daily', 'weekly', 'monthly', 'custom')),
  interval_days integer,
  next_run_at timestamptz,
  enabled boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists task_recurrence_source_uidx
  on public.task_recurrence_rules (source_task_id);

-- ---------------------------------------------------------------------------
-- RLS (read via RPC; tables locked down)
-- ---------------------------------------------------------------------------
alter table public.task_step_lists enable row level security;
alter table public.task_steps enable row level security;
alter table public.task_attachments enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_evidence enable row level security;
alter table public.task_reminder_deliveries enable row level security;
alter table public.task_recurrence_rules enable row level security;

revoke all on table public.task_step_lists from public;
revoke all on table public.task_steps from public;
revoke all on table public.task_attachments from public;
revoke all on table public.task_comments from public;
revoke all on table public.task_evidence from public;
revoke all on table public.task_reminder_deliveries from public;
revoke all on table public.task_recurrence_rules from public;

grant select on table public.task_step_lists to authenticated;
grant select on table public.task_steps to authenticated;
grant select on table public.task_attachments to authenticated;
grant select on table public.task_comments to authenticated;
grant select on table public.task_evidence to authenticated;
grant select on table public.task_reminder_deliveries to authenticated;
grant select on table public.task_recurrence_rules to authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket (private)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-files',
  'task-files',
  false,
  20971520,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/jpg',
    'image/gif',
    'video/mp4',
    'video/quicktime',
    'text/plain'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists task_files_read on storage.objects;
create policy task_files_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'task-files'
    and exists (
      select 1
      from public.assigned_tasks t
      where t.task_source = 'operational'
        and t.deleted_at is null
        and public.can_access_operational_task(t, 'view')
        and (storage.foldername(name))[1] = t.id
    )
  );

drop policy if exists task_files_insert on storage.objects;
create policy task_files_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-files'
    and exists (
      select 1
      from public.assigned_tasks t
      where t.task_source = 'operational'
        and t.deleted_at is null
        and public.can_mutate_operational_task(t)
        and (storage.foldername(name))[1] = t.id
    )
  );

drop policy if exists task_files_update on storage.objects;
create policy task_files_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'task-files'
    and exists (
      select 1
      from public.assigned_tasks t
      where t.task_source = 'operational'
        and public.can_mutate_operational_task(t)
        and (storage.foldername(name))[1] = t.id
    )
  )
  with check (bucket_id = 'task-files');

-- ---------------------------------------------------------------------------
-- Migrate simple_steps jsonb → relational plan (one-time)
-- ---------------------------------------------------------------------------
do $$
declare
  v_task record;
  v_list_id uuid;
  v_step jsonb;
  v_pos numeric;
  v_idx int;
begin
  for v_task in
    select t.id, t.simple_steps
    from public.assigned_tasks t
    where t.task_source = 'operational'
      and coalesce(jsonb_array_length(t.simple_steps), 0) > 0
      and not exists (
        select 1 from public.task_step_lists sl
        where sl.task_id = t.id and sl.deleted_at is null
      )
  loop
    insert into public.task_step_lists (task_id, title, sort_position)
    values (v_task.id, 'Plan de trabajo', 0)
    returning id into v_list_id;

    v_idx := 0;
    for v_step in select * from jsonb_array_elements(v_task.simple_steps)
    loop
      insert into public.task_steps (
        step_list_id, task_id, text, completed, sort_position
      )
      values (
        v_list_id,
        v_task.id,
        coalesce(nullif(trim(v_step ->> 'text'), ''), nullif(trim(v_step ->> 'title'), ''), 'Paso'),
        coalesce((v_step ->> 'done')::boolean, (v_step ->> 'completed')::boolean, false),
        v_idx::numeric * 1024
      );
      v_idx := v_idx + 1;
    end loop;
  end loop;
end;
$$;
