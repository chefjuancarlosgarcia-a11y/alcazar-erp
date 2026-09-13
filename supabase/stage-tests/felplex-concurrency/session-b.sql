-- Session B: concurrent claim; expect FEL_ALREADY_PROCESSING after waiting on Session A lock.

create temp table fel_session_b_result (
  started_at timestamptz not null,
  finished_at timestamptz not null,
  elapsed_ms numeric not null,
  rejected boolean not null,
  error_text text not null
) on commit drop;

do $session_b$
declare
  v_started timestamptz := clock_timestamp();
  v_finished timestamptz;
  v_elapsed_ms numeric;
  v_err text;
  v_ok boolean := false;
begin
  begin
    perform public.fel_claim_pos_fel_certification_attempt(
      '{{DOCUMENT_ID}}'::uuid,
      '{{ACTOR_ID}}'::uuid
    );
    v_finished := clock_timestamp();
    v_elapsed_ms := round(extract(epoch from (v_finished - v_started)) * 1000, 2);
    insert into fel_session_b_result values (
      v_started, v_finished, v_elapsed_ms, false,
      'SESSION_B_UNEXPECTED_SUCCESS: second claim must be rejected'
    );
  exception
    when others then
      v_finished := clock_timestamp();
      v_elapsed_ms := round(extract(epoch from (v_finished - v_started)) * 1000, 2);
      v_err := sqlerrm;
      v_ok := v_err like '%FEL_ALREADY_PROCESSING%';
      insert into fel_session_b_result values (
        v_started, v_finished, v_elapsed_ms, v_ok, v_err
      );
      if not v_ok then
        raise;
      end if;
  end;
end;
$session_b$;

select jsonb_build_object(
  'phase', 'session_b',
  'started_at', started_at,
  'finished_at', finished_at,
  'elapsed_ms', elapsed_ms,
  'rejected', rejected,
  'error', error_text
) as session_b_result
from fel_session_b_result;
