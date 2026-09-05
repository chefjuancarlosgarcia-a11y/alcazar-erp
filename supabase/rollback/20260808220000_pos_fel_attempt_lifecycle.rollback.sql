-- Rollback for 20260808220000_pos_fel_attempt_lifecycle.sql
-- Limited to objects created by that migration only.
-- Drop order: finalize → claim → safe payload validator → actor helper

revoke all on function
  public.fel_claim_pos_fel_certification_attempt(uuid, uuid),
  public.fel_finalize_pos_fel_certification_attempt(
    uuid, uuid, text, text, text, text, text, timestamptz, integer, text, text, jsonb, jsonb
  )
from service_role;

drop function if exists public.fel_finalize_pos_fel_certification_attempt(
  uuid, uuid, text, text, text, text, text, timestamptz, integer, text, text, jsonb, jsonb
);

drop function if exists public.fel_claim_pos_fel_certification_attempt(uuid, uuid);

drop function if exists public.fel_validate_safe_response_payload(jsonb);

drop function if exists public.fel_actor_can_request_certification(uuid);
