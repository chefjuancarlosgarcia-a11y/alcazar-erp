-- Restrict RRHH Expedientes to admin, gerente_general and rrhh only.
-- Apply after 090_employee_expedientes.sql

-- ---------------------------------------------------------------------------
-- Permission helpers (read + write: same three roles)
-- ---------------------------------------------------------------------------

create or replace function public.can_read_employee_expedientes()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and public.normalize_profile_role(p.role) in (
        'admin',
        'gerente_general',
        'recursos_humanos'
      )
  );
$$;

create or replace function public.can_write_employee_expedientes()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and public.normalize_profile_role(p.role) in (
        'admin',
        'gerente_general',
        'recursos_humanos'
      )
  );
$$;

comment on function public.can_read_employee_expedientes() is
  'Expedientes read access: admin, gerente_general, recursos_humanos (rrhh).';

comment on function public.can_write_employee_expedientes() is
  'Expedientes write access: admin, gerente_general, recursos_humanos (rrhh).';

-- ---------------------------------------------------------------------------
-- RLS (employee expedientes tables)
-- ---------------------------------------------------------------------------

drop policy if exists "employee_file_types_read" on public.employee_file_types;
create policy "employee_file_types_read"
  on public.employee_file_types for select to authenticated
  using (public.can_read_employee_expedientes());

drop policy if exists "employee_file_profiles_read" on public.employee_file_profiles;
create policy "employee_file_profiles_read"
  on public.employee_file_profiles for select to authenticated
  using (public.can_read_employee_expedientes());

drop policy if exists "employee_file_profiles_write" on public.employee_file_profiles;
create policy "employee_file_profiles_write"
  on public.employee_file_profiles for all to authenticated
  using (public.can_write_employee_expedientes())
  with check (public.can_write_employee_expedientes());

drop policy if exists "employee_files_read" on public.employee_files;
create policy "employee_files_read"
  on public.employee_files for select to authenticated
  using (public.can_read_employee_expedientes());

drop policy if exists "employee_files_write" on public.employee_files;
create policy "employee_files_write"
  on public.employee_files for all to authenticated
  using (public.can_write_employee_expedientes())
  with check (public.can_write_employee_expedientes());

drop policy if exists "employee_file_versions_read" on public.employee_file_versions;
create policy "employee_file_versions_read"
  on public.employee_file_versions for select to authenticated
  using (public.can_read_employee_expedientes());

drop policy if exists "employee_file_versions_write" on public.employee_file_versions;
create policy "employee_file_versions_write"
  on public.employee_file_versions for insert to authenticated
  with check (public.can_write_employee_expedientes());

drop policy if exists "employee_file_alerts_read" on public.employee_file_alerts;
create policy "employee_file_alerts_read"
  on public.employee_file_alerts for select to authenticated
  using (public.can_read_employee_expedientes());

drop policy if exists "employee_labor_history_read" on public.employee_labor_history;
create policy "employee_labor_history_read"
  on public.employee_labor_history for select to authenticated
  using (public.can_read_employee_expedientes());

drop policy if exists "employee_labor_history_write" on public.employee_labor_history;
create policy "employee_labor_history_write"
  on public.employee_labor_history for insert to authenticated
  with check (public.can_write_employee_expedientes());

-- ---------------------------------------------------------------------------
-- Storage bucket employee-documents
-- ---------------------------------------------------------------------------

drop policy if exists "employee_documents_read" on storage.objects;
create policy "employee_documents_read"
  on storage.objects for select to authenticated
  using (bucket_id = 'employee-documents' and public.can_read_employee_expedientes());

drop policy if exists "employee_documents_insert" on storage.objects;
create policy "employee_documents_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-documents' and public.can_write_employee_expedientes());

drop policy if exists "employee_documents_update" on storage.objects;
create policy "employee_documents_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'employee-documents' and public.can_write_employee_expedientes())
  with check (bucket_id = 'employee-documents' and public.can_write_employee_expedientes());

drop policy if exists "employee_documents_delete" on storage.objects;
create policy "employee_documents_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'employee-documents' and public.can_write_employee_expedientes());

revoke all on function public.can_read_employee_expedientes() from public;
revoke all on function public.can_write_employee_expedientes() from public;

grant execute on function public.can_read_employee_expedientes() to authenticated;
grant execute on function public.can_write_employee_expedientes() to authenticated;
