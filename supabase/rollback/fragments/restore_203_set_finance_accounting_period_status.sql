-- Restore 203 version of set_finance_accounting_period_status after 204 rollback.
-- Included from 204_finance_accounting_journal_engine.rollback.sql
\set ON_ERROR_STOP on

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
