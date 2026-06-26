-- Hotfix: protect_inventory_migration_mode_setting bloqueaba el INSERT inicial
-- en SQL Editor porque auth.uid() es null al ejecutar como postgres.
-- Aplicar si 131 falló en el INSERT final o si ya existe el trigger.

create or replace function public.protect_inventory_migration_mode_setting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.key <> 'inventory_migration_mode' then
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  if public.normalize_profile_role(public.current_profile_role()) <> 'admin' then
    raise exception 'No tiene permisos para modificar el Modo Migración. Solo un Administrador del sistema puede realizar esta acción.';
  end if;
  return new;
end;
$$;

insert into public.app_settings (key, value)
values ('inventory_migration_mode', public.inventory_migration_mode_default())
on conflict (key) do nothing;
