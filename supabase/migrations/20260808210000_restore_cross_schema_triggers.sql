-- Restore cross-schema triggers omitted from the public schema-only baseline dump.
--
-- Historical source:
--   supabase/schema/001_profiles.sql (lines 140-143)
--
-- Cross-schema audit (supabase/schema/, excluding tests/rollback):
--   - 1 trigger on auth.users: on_auth_user_created → public.handle_new_user()
--   - 0 triggers on storage.* (storage files define buckets/policies only)
--   - No later schema file modifies or replaces this trigger
--
-- Does NOT modify functions, profiles, auth users, roles, POS, FEL, or storage policies.
-- Idempotent: creates the trigger only when absent; no-op when already correct;
-- raises a clear exception when a same-named trigger exists with a different definition.

do $$
declare
  v_trigger_oid oid;
  v_actual_def text;
begin
  if to_regprocedure('public.handle_new_user()') is null then
    raise exception
      'Cannot restore auth.users trigger: public.handle_new_user() is missing.';
  end if;

  select t.oid
  into v_trigger_oid
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'auth'
    and c.relname = 'users'
    and t.tgname = 'on_auth_user_created'
    and not t.tgisinternal;

  if v_trigger_oid is not null then
    if not exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace rel_ns on rel_ns.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      join pg_namespace fn_ns on fn_ns.oid = p.pronamespace
      where t.oid = v_trigger_oid
        and rel_ns.nspname = 'auth'
        and c.relname = 'users'
        and t.tgname = 'on_auth_user_created'
        and fn_ns.nspname = 'public'
        and p.proname = 'handle_new_user'
        and p.pronargs = 0
        and t.tgtype = 5          -- exactly AFTER INSERT FOR EACH ROW
        and t.tgenabled = 'O'     -- enabled in the canonical/default mode
        and t.tgqual is null      -- no WHEN condition
        and t.tgnargs = 0
        and octet_length(t.tgargs) = 0
        and t.tgconstraint = 0    -- not a constraint trigger
        and not t.tgisinternal
    ) then
      v_actual_def := regexp_replace(
        pg_get_triggerdef(v_trigger_oid, true),
        '[[:cntrl:]]+',
        ' ',
        'g'
      );
      raise exception
        'auth.users trigger on_auth_user_created exists with unexpected definition: %. Expected AFTER INSERT ON auth.users FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user().',
        v_actual_def;
    end if;

    return;
  end if;

  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();
end;
$$;
