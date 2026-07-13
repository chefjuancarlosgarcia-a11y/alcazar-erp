-- 183c: Task label catalog CRUD — apply after 183b.

-- ---------------------------------------------------------------------------
-- Who can create / edit / delete labels in the catalog
-- ---------------------------------------------------------------------------
create or replace function public.can_administer_task_labels()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.normalize_profile_role(public.current_profile_role()) in (
    'admin',
    'ceo',
    'gerente_general',
    'gerente',
    'recursos_humanos'
  );
$$;

-- ---------------------------------------------------------------------------
-- Create label
-- ---------------------------------------------------------------------------
create or replace function public.create_task_label(
  p_name text,
  p_color_key text default 'teal',
  p_description text default null,
  p_scope text default 'global',
  p_area_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_scope text;
  v_row public.task_labels;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  if not public.can_administer_task_labels() then
    raise exception 'No tienes permiso para crear etiquetas.';
  end if;

  v_name := nullif(trim(p_name), '');
  if v_name is null then
    raise exception 'El nombre de la etiqueta es obligatorio.';
  end if;

  if p_color_key is null
    or p_color_key not in ('teal', 'blue', 'green', 'yellow', 'orange', 'red', 'purple', 'pink', 'slate') then
    raise exception 'Color de etiqueta inválido.';
  end if;

  v_scope := coalesce(nullif(trim(p_scope), ''), 'global');
  if v_scope not in ('global', 'area') then
    raise exception 'Alcance de etiqueta inválido.';
  end if;

  if v_scope = 'area' and nullif(trim(p_area_id), '') is null then
    raise exception 'Las etiquetas de área requieren area_id.';
  end if;

  if exists (
    select 1
    from public.task_labels l
    where l.deleted_at is null
      and lower(l.name) = lower(v_name)
      and l.scope = v_scope
      and coalesce(l.area_id, '') = coalesce(nullif(trim(p_area_id), ''), '')
  ) then
    raise exception 'Ya existe una etiqueta con ese nombre.';
  end if;

  insert into public.task_labels (
    name,
    color_key,
    description,
    scope,
    area_id,
    created_by
  )
  values (
    v_name,
    p_color_key,
    nullif(trim(p_description), ''),
    v_scope,
    case when v_scope = 'area' then nullif(trim(p_area_id), '') else null end,
    auth.uid()
  )
  returning * into v_row;

  return jsonb_build_object(
    'label',
    jsonb_build_object(
      'id', v_row.id,
      'name', v_row.name,
      'color_key', v_row.color_key,
      'description', v_row.description,
      'scope', v_row.scope,
      'area_id', v_row.area_id
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Update label
-- ---------------------------------------------------------------------------
create or replace function public.update_task_label(
  p_label_id uuid,
  p_name text default null,
  p_color_key text default null,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.task_labels;
  v_name text;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  if not public.can_administer_task_labels() then
    raise exception 'No tienes permiso para editar etiquetas.';
  end if;

  select * into v_row
  from public.task_labels l
  where l.id = p_label_id
    and l.deleted_at is null
  for update;

  if not found then
    raise exception 'Etiqueta no encontrada.';
  end if;

  v_name := coalesce(nullif(trim(p_name), ''), v_row.name);

  if p_color_key is not null
    and p_color_key not in ('teal', 'blue', 'green', 'yellow', 'orange', 'red', 'purple', 'pink', 'slate') then
    raise exception 'Color de etiqueta inválido.';
  end if;

  if exists (
    select 1
    from public.task_labels l
    where l.deleted_at is null
      and l.id <> p_label_id
      and lower(l.name) = lower(v_name)
      and l.scope = v_row.scope
      and coalesce(l.area_id, '') = coalesce(v_row.area_id, '')
  ) then
    raise exception 'Ya existe una etiqueta con ese nombre.';
  end if;

  update public.task_labels l
  set
    name = v_name,
    color_key = coalesce(p_color_key, l.color_key),
    description = case
      when p_description is null then l.description
      else nullif(trim(p_description), '')
    end,
    updated_at = now()
  where l.id = p_label_id
  returning * into v_row;

  return jsonb_build_object(
    'label',
    jsonb_build_object(
      'id', v_row.id,
      'name', v_row.name,
      'color_key', v_row.color_key,
      'description', v_row.description,
      'scope', v_row.scope,
      'area_id', v_row.area_id
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Delete label (soft) + detach from tasks
-- ---------------------------------------------------------------------------
create or replace function public.delete_task_label(
  p_label_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.task_labels;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  if not public.can_administer_task_labels() then
    raise exception 'No tienes permiso para eliminar etiquetas.';
  end if;

  select * into v_row
  from public.task_labels l
  where l.id = p_label_id
    and l.deleted_at is null
  for update;

  if not found then
    raise exception 'Etiqueta no encontrada.';
  end if;

  delete from public.task_label_assignments tla
  where tla.label_id = p_label_id;

  update public.task_labels l
  set
    deleted_at = now(),
    updated_at = now()
  where l.id = p_label_id;

  return jsonb_build_object(
    'deleted_id', p_label_id,
    'name', v_row.name
  );
end;
$$;

-- Catalog includes administer flag for UI
create or replace function public.get_task_labels_catalog(
  p_area_id text default null,
  p_include_archived boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', l.id,
      'name', l.name,
      'color_key', l.color_key,
      'description', l.description,
      'scope', l.scope,
      'area_id', l.area_id,
      'area_name', (select a.name from public.areas a where a.id = l.area_id)
    )
    order by l.scope, l.name
  ), '[]'::jsonb)
  into v_rows
  from public.task_labels l
  where l.deleted_at is null
    and (p_include_archived or l.archived_at is null)
    and (
      l.scope = 'global'
      or (l.scope = 'area' and (p_area_id is null or l.area_id = p_area_id))
    );

  return jsonb_build_object(
    'labels', v_rows,
    'can_administer', public.can_administer_task_labels()
  );
end;
$$;

revoke all on function public.can_administer_task_labels() from public;
revoke all on function public.create_task_label(text, text, text, text, text) from public;
revoke all on function public.update_task_label(uuid, text, text, text) from public;
revoke all on function public.delete_task_label(uuid) from public;

grant execute on function public.can_administer_task_labels() to authenticated;
grant execute on function public.create_task_label(text, text, text, text, text) to authenticated;
grant execute on function public.update_task_label(uuid, text, text, text) to authenticated;
grant execute on function public.delete_task_label(uuid) to authenticated;
