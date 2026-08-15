-- ROLLBACK 204 — finance journal engine (Stage-only, fail-closed).
-- Order: run BEFORE 203 rollback. Requires explicit Stage confirmation.
-- Does NOT use CASCADE on unrelated objects.
-- Forward path: supabase/schema/204_finance_accounting_journal_engine.sql
\set ON_ERROR_STOP on

begin;

do $guard$
declare
  v_env text := lower(coalesce(
    (select value ->> 'name' from public.app_settings where key = 'deployment_environment'),
    ''
  ));
  v_stored_ref text := nullif(trim(coalesce(
    (select value ->> 'project_ref' from public.app_settings where key = 'deployment_environment'),
    ''
  )), '');
  v_session_ref text := nullif(trim(coalesce(current_setting('alcazar.finance_stage_project_ref', true), '')), '');
begin
  if v_env in ('production', 'prod') then
    raise exception '204 rollback blocked: production environment';
  end if;
  if v_env <> 'stage' then
    raise exception '204 rollback blocked: deployment_environment.name must be stage';
  end if;
  if v_session_ref is null then
    raise exception '204 rollback blocked: set alcazar.finance_stage_project_ref before rollback';
  end if;
  if v_stored_ref is null then
    raise exception '204 rollback blocked: deployment_environment.project_ref missing';
  end if;
  if v_session_ref <> v_stored_ref then
    raise exception '204 rollback blocked: session project ref does not match stored value';
  end if;
end $guard$;

do $check$
begin
  if exists (
    select 1 from public.finance_journal_entries
    where status = 'posted'
      and coalesce(description, '') not like 'STAGE_FINANCE_SMOKE%'
  ) then
    raise exception '204 rollback rejected: posted journal entries exist outside smoke prefix';
  end if;
  if exists (
    select 1 from public.finance_journal_entries je
    where je.status <> 'draft'
      and coalesce(je.description, '') not like 'STAGE_FINANCE_SMOKE%'
  ) then
    raise exception '204 rollback rejected: non-draft journal workflow data exists';
  end if;
end $check$;

drop policy if exists finance_journal_lines_select on public.finance_journal_lines;
drop policy if exists finance_journal_entries_select on public.finance_journal_entries;

drop trigger if exists finance_journal_lines_block_posted on public.finance_journal_lines;
drop trigger if exists finance_journal_entries_block_posted on public.finance_journal_entries;
drop trigger if exists finance_journal_entries_guard_transitions on public.finance_journal_entries;
drop trigger if exists finance_journal_lines_updated_at on public.finance_journal_lines;
drop trigger if exists finance_journal_entries_updated_at on public.finance_journal_entries;

drop function if exists public.list_finance_journal_entries(text, uuid, date, date, text);
drop function if exists public.get_finance_journal_entry(uuid);
drop function if exists public.reverse_finance_journal_entry(uuid, text, date);
drop function if exists public.post_finance_journal_entry(uuid);
drop function if exists public.approve_finance_journal_entry(uuid);
drop function if exists public.reject_finance_journal_entry(uuid, text);
drop function if exists public.submit_finance_journal_entry(uuid);
drop function if exists public.replace_finance_journal_lines(uuid, jsonb);
drop function if exists public.create_finance_journal_draft(jsonb);
drop function if exists public.finance_journal_entry_row_to_json(public.finance_journal_entries);
drop function if exists public.finance_journal_line_row_to_json(public.finance_journal_lines);
drop function if exists public.finance_journal_assert_postable_period(public.finance_accounting_periods);
drop function if exists public.finance_journal_validate_entry_balance(uuid);
drop function if exists public.finance_journal_validate_line(jsonb);
drop function if exists public.finance_journal_validate_cost_center_branch(uuid, uuid);
drop function if exists public.finance_journal_next_entry_number(integer);
drop function if exists public.finance_journal_resolve_period(date);
drop function if exists public.finance_journal_line_block_posted_parent();
drop function if exists public.finance_journal_entry_block_posted_mutation();
drop function if exists public.finance_journal_entry_guard_transitions();
drop function if exists public.accounting_journal_branch_scope();
drop function if exists public.can_reverse_journal();
drop function if exists public.can_post_journal_in_soft_closed_period();
drop function if exists public.can_post_journal();
drop function if exists public.can_approve_journal();
drop function if exists public.can_create_journal();
drop function if exists public.can_view_accounting();

drop table if exists public.finance_journal_lines;
drop table if exists public.finance_journal_entries;
drop table if exists public.finance_journal_entry_counters;

create or replace function public.set_finance_accounting_period_status(
  p_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_accounting_periods;
  v_status text := lower(trim(coalesce(p_status, '')));
begin
  if v_status = 'closed' then
    if not public.can_close_accounting_period() then
      raise exception 'No tienes permiso para cerrar periodos contables.';
    end if;
  elsif v_status = 'soft_closed' then
    if not (public.can_manage_accounting_periods() or public.can_close_accounting_period()) then
      raise exception 'No tienes permiso para administrar periodos contables.';
    end if;
  elsif v_status = 'open' then
    if not public.can_manage_accounting_periods() then
      raise exception 'Use reopen_finance_accounting_period para reabrir un periodo cerrado.';
    end if;
  else
    raise exception 'Estado de periodo inválido.';
  end if;

  if v_status not in ('open', 'soft_closed', 'closed') then
    raise exception 'Estado de periodo inválido.';
  end if;

  select * into v_row from public.finance_accounting_periods where id = p_id for update;
  if not found then raise exception 'Periodo contable no encontrado.'; end if;

  if v_row.status = 'closed' and v_status <> 'closed' then
    raise exception 'Use reopen_finance_accounting_period para reabrir un periodo cerrado.';
  end if;
  if v_row.status = 'open' and v_status = 'open' then
    raise exception 'El periodo ya está abierto.';
  end if;

  update public.finance_accounting_periods
  set
    status = v_status,
    closed_at = case when v_status in ('soft_closed', 'closed') then now() else closed_at end,
    closed_by = case when v_status in ('soft_closed', 'closed') then auth.uid() else closed_by end,
    updated_by = auth.uid()
  where id = p_id
  returning * into v_row;

  return public.finance_accounting_period_row_to_json(v_row);
end;
$$;

revoke all on function public.set_finance_accounting_period_status(uuid, text) from public;
grant execute on function public.set_finance_accounting_period_status(uuid, text) to authenticated;

do $validate$
begin
  if to_regclass('public.finance_journal_entries') is not null then
    raise exception '204 rollback validation failed: finance_journal_entries still exists';
  end if;
  if to_regprocedure('public.create_finance_journal_draft(jsonb)') is not null then
    raise exception '204 rollback validation failed: create_finance_journal_draft still exists';
  end if;
end $validate$;

select 'PASS' as rollback_204_finance_accounting_journal_engine;

commit;
