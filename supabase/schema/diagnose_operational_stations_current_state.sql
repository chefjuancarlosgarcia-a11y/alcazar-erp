-- Read-only inventory for operational stations audit (no DDL/DML).
-- Export single result set; no PIN hashes or PII.
-- Do not run without explicit approval.

select jsonb_pretty(
  jsonb_build_object(
    'generated_at', now() at time zone 'utc',
    'tables', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select
          c.relname as table_name,
          pg_total_relation_size(c.oid) as total_bytes,
          (select count(*) from information_schema.columns col
           where col.table_schema = 'public' and col.table_name = c.relname) as column_count
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and c.relname in (
            'attendance_devices',
            'attendance_security_events',
            'attendance_security_settings',
            'attendance_credentials',
            'attendance_marks',
            'profiles',
            'areas',
            'user_production_areas',
            'production_tickets',
            'cash_registers',
            'cash_sessions',
            'cash_movements',
            'pos_orders'
          )
        order by c.relname
      ) t
    ),
    'row_counts', jsonb_build_object(
      'attendance_devices', (select count(*) from public.attendance_devices),
      'attendance_devices_authorized', (select count(*) from public.attendance_devices where status = 'authorized'),
      'attendance_devices_pending', (select count(*) from public.attendance_devices where status = 'pending'),
      'attendance_devices_blocked', (select count(*) from public.attendance_devices where status = 'blocked'),
      'attendance_credentials', (select count(*) from public.attendance_credentials),
      'profiles_active', (select count(*) from public.profiles where status = 'active'),
      'profiles_with_attendance_pin', (
        select count(*) from public.attendance_credentials c
        join public.profiles p on p.id = c.employee_id and p.status = 'active'
      ),
      'production_areas_active', (
        select count(*) from public.areas where is_production_area = true and active = true
      ),
      'user_production_area_assignments_active', (
        select count(*) from public.user_production_areas where is_active = true
      ),
      'cash_registers_active', (select count(*) from public.cash_registers where status = 'active'),
      'cash_sessions_open', (select count(*) from public.cash_sessions where status = 'open'),
      'pos_orders_open', (
        select count(*) from public.pos_orders
        where status in ('open', 'sent_to_production', 'ready', 'pendiente_cierre')
      )
    ),
    'attendance_security_settings', public.get_attendance_security_settings_value(),
    'rls_enabled', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', c.relname,
        'rls', c.relrowsecurity
      ) order by c.relname), '[]'::jsonb)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relname in (
          'attendance_devices', 'attendance_credentials', 'attendance_marks',
          'user_production_areas', 'cash_sessions', 'cash_movements', 'pos_orders'
        )
    ),
    'key_functions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', p.proname,
        'args', pg_get_function_identity_arguments(p.oid)
      ) order by p.proname), '[]'::jsonb)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'can_operate_pos_orders',
          'can_operate_production_tickets',
          'is_cash_operator',
          'register_attendance_mark',
          'get_attendance_security_status',
          'authorize_attendance_device',
          'open_pos_table_service',
          'release_pos_table_service'
        )
    ),
    'missing_operational_station_objects', jsonb_build_object(
      'operational_stations_table', not exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'operational_stations'
      ),
      'station_devices_table', not exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'station_devices'
      ),
      'operational_pins_table', not exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'operational_pins'
      ),
      'operator_sessions_table', not exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'operator_sessions'
      )
    )
  )
) as operational_stations_audit_snapshot;
