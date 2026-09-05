-- Restore canonical ERP role catalog into public.user_roles (Stage seed).
-- Data-only migration synthesized from schema history:
--   033_user_roles_catalog.sql      — base 25 system roles
--   052_user_roles_hr_assignable_and_rpc.sql — is_deprecated, hr_assignable
--   156_bakery_production_center.sql — supervisor_panaderia
--
-- 034_fix_hr_schedule_permissions re-inserts recursos_humanos/rrhh already present in 033.
-- Does NOT copy functions, RPC, triggers, RLS, or profile updates.
-- Bootstrap inserts missing canonical roles but never overwrites live configuration.
-- Future catalog reconciliations require an explicit, separately reviewed migration.
-- Idempotent: existing role_key rows remain unchanged.

insert into public.user_roles (
  role_key,
  role_name,
  description,
  category,
  is_system,
  is_active,
  is_deprecated,
  hr_assignable
)
values
  -- 033 — Management
  ('admin', 'Admin', null, 'Administración', true, true, false, false),
  ('gerente_general', 'Gerente General', null, 'Administración', true, true, false, false),
  ('gerente', 'Gerente', null, 'Administración', true, true, false, false),

  -- 033 — Staff Management
  ('recursos_humanos', 'Recursos Humanos', null, 'Administración', true, true, false, false),
  ('encargado_almacen', 'Encargado de Almacén', null, 'Operativo', true, true, false, true),
  ('supervisor', 'Supervisor', null, 'Operativo', true, true, false, true),

  -- 033 — Finance/Cash
  ('caja', 'Cajero', null, 'Servicio', true, true, false, true),

  -- 033 — Front of House (Service)
  ('mesero', 'Mesero', null, 'Servicio', true, true, false, true),
  ('barista', 'Barista', null, 'Servicio', true, true, false, true),
  ('bartender', 'Bartender', null, 'Servicio', true, true, false, true),

  -- 033 — Kitchen
  ('cocina', 'Cocinero', null, 'Cocina', true, true, false, true),
  ('pizzeria', 'Pizzero', null, 'Cocina', true, true, false, true),
  ('panadero', 'Panadero', null, 'Cocina', true, true, false, true),
  ('repostero', 'Repostero', null, 'Cocina', true, true, false, true),

  -- 033 — Support Services
  ('servicio', 'Servicio General', null, 'Operativo', true, true, false, true),
  ('cafeteria', 'Cafetería', null, 'Cocina', true, true, false, false),
  ('limpieza', 'Limpieza', null, 'Operativo', true, true, false, true),
  ('repartidor', 'Repartidor', null, 'Operativo', true, true, false, true),
  ('mantenimiento', 'Mantenimiento', null, 'Operativo', true, true, false, true),
  ('operativo', 'Operativo', null, 'Operativo', true, true, false, true),
  ('colaborador', 'Colaborador', null, 'Operativo', true, true, false, true),

  -- 033 — Backward compatibility aliases (052 marks deprecated)
  ('rrhh', 'RRHH (Deprecated)', null, 'Administración', true, true, true, false),
  ('cajero', 'Cajero (Deprecated)', null, 'Servicio', true, true, true, false),
  ('cocinero', 'Cocinero (Deprecated)', null, 'Cocina', true, true, true, false),
  ('pizzero', 'Pizzero (Deprecated)', null, 'Cocina', true, true, true, false),

  -- 156 — Bakery production center
  (
    'supervisor_panaderia',
    'Supervisor Panadería',
    'Opera producción de panadería y pastelería: lotes, diario, masas y merma.',
    'produccion',
    true,
    true,
    false,
    false
  )
on conflict (role_key) do nothing;
