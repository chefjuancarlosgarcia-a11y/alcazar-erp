-- Checklist session interruption / autosave audit trail

create table if not exists public.checklist_session_audit (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  checklist_run_id uuid references public.checklist_runs(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists checklist_session_audit_run_idx
  on public.checklist_session_audit (checklist_run_id, created_at desc);

create index if not exists checklist_session_audit_profile_idx
  on public.checklist_session_audit (profile_id, created_at desc);

alter table public.checklist_session_audit enable row level security;

drop policy if exists "checklist_session_audit_own_read" on public.checklist_session_audit;
create policy "checklist_session_audit_own_read"
  on public.checklist_session_audit for select to authenticated
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and public.normalize_profile_role(p.role) in ('admin', 'gerente_general')
    )
  );

drop policy if exists "checklist_session_audit_own_insert" on public.checklist_session_audit;
create policy "checklist_session_audit_own_insert"
  on public.checklist_session_audit for insert to authenticated
  with check (profile_id = auth.uid());

grant select, insert on public.checklist_session_audit to authenticated;
