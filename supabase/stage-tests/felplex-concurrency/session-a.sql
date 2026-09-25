-- Session A: claim + hold transaction 10s (COMMIT releases lock).

create temp table fel_session_a_capture (
  claim jsonb not null,
  started_at timestamptz not null,
  committed_at timestamptz
) on commit preserve rows;

begin;

insert into fel_session_a_capture (claim, started_at)
select
  public.fel_claim_pos_fel_certification_attempt(
    '{{DOCUMENT_ID}}'::uuid,
    '{{ACTOR_ID}}'::uuid
  ),
  clock_timestamp();

select pg_sleep(10);

update fel_session_a_capture set committed_at = clock_timestamp();

commit;

select jsonb_build_object(
  'phase', 'session_a',
  'claim', claim,
  'started_at', started_at,
  'committed_at', committed_at
) as session_a_result
from fel_session_a_capture;

drop table fel_session_a_capture;
