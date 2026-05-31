-- Public attendance kiosk access.
-- Apply after 019_attendance_terminal.sql.

grant execute on function public.get_attendance_terminal_profiles() to anon;
grant execute on function public.get_attendance_terminal_marks() to anon;
grant execute on function public.verify_attendance_pin(uuid,text) to anon;
grant execute on function public.register_attendance_mark(uuid,text,text,text,text,text) to anon;

drop policy if exists "attendance_evidence_kiosk_insert" on storage.objects;
create policy "attendance_evidence_kiosk_insert"
  on storage.objects for insert to anon
  with check (bucket_id = 'attendance-evidence');
