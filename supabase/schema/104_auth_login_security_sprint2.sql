-- Login security sprint 2: log retention + suspicious successful login alerts.
-- Apply after 103_auth_login_security.sql.
--
-- PRODUCTION ACTIVATION (retention)
-- --------------------------------
-- Option A — pg_cron (Supabase Dashboard → Database → Extensions → enable pg_cron):
--   Run the schedule block at the end of this file in the SQL editor.
--
-- Option B — Scheduled Edge Function (if pg_cron unavailable):
--   1. Deploy: supabase functions deploy purge-login-security-logs
--   2. Set secret CRON_SECRET (optional, for manual/cron invocations)
--   3. Supabase Dashboard → Edge Functions → purge-login-security-logs → Schedules
--      Cron: 0 4 * * *  (daily 04:00 UTC)
--      Headers: x-cron-secret: <CRON_SECRET>
--
-- Manual test purge (service role):
--   select public.purge_old_security_login_logs();

-- ---------------------------------------------------------------------------
-- Settings helpers
-- ---------------------------------------------------------------------------

create or replace function public.login_security_retention_days()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 90;
$$;

create or replace function public.login_security_suspicious_dedup_minutes()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 1440;
$$;

create or replace function public.login_security_user_agent_fingerprint(p_user_agent text)
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(coalesce(nullif(trim(p_user_agent), ''), 'unknown'));
$$;

create or replace function public.login_security_is_unusual_hour(p_moment timestamptz default now())
returns boolean
language sql
stable
set search_path = ''
as $$
  select not (
    extract(hour from (p_moment at time zone 'America/Guatemala')) >= 6
    and extract(hour from (p_moment at time zone 'America/Guatemala')) < 22
  );
$$;

comment on function public.login_security_is_unusual_hour(timestamptz) is
  'Unusual = outside 06:00–21:59 America/Guatemala.';

-- ---------------------------------------------------------------------------
-- Notification helper (configurable dedup window)
-- ---------------------------------------------------------------------------

create or replace function public.create_login_security_notification(
  p_type text,
  p_title text,
  p_message text,
  p_entity_id text default null,
  p_dedup_minutes integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role text;
  v_dedup_minutes integer := coalesce(p_dedup_minutes, public.login_security_window_minutes());
begin
  foreach target_role in array array['admin', 'gerente_general']
  loop
    insert into public.notifications (
      user_id,
      target_role,
      type,
      title,
      message,
      entity_type,
      entity_id,
      action_url
    )
    select
      null,
      target_role,
      p_type,
      p_title,
      p_message,
      'security_login',
      p_entity_id,
      '/settings?tab=login-security'
    where not exists (
      select 1
      from public.notifications notification
      where notification.type = p_type
        and notification.entity_type = 'security_login'
        and coalesce(notification.entity_id, '') = coalesce(p_entity_id, '')
        and notification.created_at >= now() - make_interval(mins => v_dedup_minutes)
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Suspicious successful login alerts
-- ---------------------------------------------------------------------------

create or replace function public.maybe_notify_suspicious_successful_login(
  p_attempt_id uuid,
  p_user_id uuid,
  p_email text,
  p_ip text,
  p_user_agent text,
  p_profile_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := p_user_id;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_ip text := nullif(trim(coalesce(p_ip, '')), '');
  v_role text := coalesce(nullif(trim(p_profile_role), ''), '');
  v_fingerprint text := public.login_security_user_agent_fingerprint(p_user_agent);
  v_prior_successes integer := 0;
  v_dedup integer := public.login_security_suspicious_dedup_minutes();
  v_day_key text := to_char(now() at time zone 'America/Guatemala', 'YYYY-MM-DD');
begin
  if v_role = '' or not (v_role = any(public.login_security_sensitive_roles())) then
    return;
  end if;

  if v_user_id is null then
    select profile.profile_id into v_user_id
    from public.resolve_login_profile(v_email) profile;
  end if;

  select count(*)::integer
  into v_prior_successes
  from public.security_login_attempts attempt
  where attempt.success = true
    and attempt.id <> p_attempt_id
    and attempt.created_at >= now() - make_interval(days => public.login_security_retention_days())
    and (
      (v_user_id is not null and attempt.user_id = v_user_id)
      or lower(attempt.email_attempted) = v_email
    );

  if v_ip is not null and v_prior_successes > 0 then
    if not exists (
      select 1
      from public.security_login_attempts attempt
      where attempt.success = true
        and attempt.id <> p_attempt_id
        and attempt.ip_address = v_ip
        and attempt.created_at >= now() - make_interval(days => public.login_security_retention_days())
        and (
          (v_user_id is not null and attempt.user_id = v_user_id)
          or lower(attempt.email_attempted) = v_email
        )
    ) then
      perform public.create_login_security_notification(
        'login_suspicious_new_ip',
        'Login sensible desde IP nueva',
        format(
          'El usuario %s (rol %s) inicio sesion desde una IP no vista antes: %s.',
          v_email,
          v_role,
          v_ip
        ),
        coalesce(v_user_id::text, v_email) || ':new_ip:' || v_day_key,
        v_dedup
      );
    end if;
  end if;

  if v_prior_successes > 0 and coalesce(p_user_agent, '') <> '' then
    if not exists (
      select 1
      from public.security_login_attempts attempt
      where attempt.success = true
        and attempt.id <> p_attempt_id
        and attempt.created_at >= now() - make_interval(days => public.login_security_retention_days())
        and public.login_security_user_agent_fingerprint(attempt.user_agent) = v_fingerprint
        and (
          (v_user_id is not null and attempt.user_id = v_user_id)
          or lower(attempt.email_attempted) = v_email
        )
    ) then
      perform public.create_login_security_notification(
        'login_suspicious_new_device',
        'Login sensible desde dispositivo nuevo',
        format(
          'El usuario %s (rol %s) inicio sesion desde un navegador/dispositivo no visto antes.',
          v_email,
          v_role
        ),
        coalesce(v_user_id::text, v_email) || ':new_device:' || v_day_key,
        v_dedup
      );
    end if;
  end if;

  if public.login_security_is_unusual_hour(now()) then
    perform public.create_login_security_notification(
      'login_suspicious_unusual_hour',
      'Login sensible en horario inusual',
      format(
        'El usuario %s (rol %s) inicio sesion fuera del horario habitual (06:00–22:00 GT). IP: %s.',
        v_email,
        v_role,
        coalesce(v_ip, 'desconocida')
      ),
      coalesce(v_user_id::text, v_email) || ':unusual_hour:' || v_day_key,
      v_dedup
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Log retention purge
-- ---------------------------------------------------------------------------

create or replace function public.purge_old_security_login_logs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts_deleted integer := 0;
  v_captcha_deleted integer := 0;
  v_cutoff timestamptz := now() - make_interval(days => public.login_security_retention_days());
begin
  delete from public.security_login_attempts attempt
  where attempt.created_at < v_cutoff;
  get diagnostics v_attempts_deleted = row_count;

  delete from public.login_captcha_sessions session
  where session.expires_at < now() - interval '7 days';
  get diagnostics v_captcha_deleted = row_count;

  return jsonb_build_object(
    'attempts_deleted', v_attempts_deleted,
    'captcha_sessions_deleted', v_captcha_deleted,
    'retention_days', public.login_security_retention_days(),
    'cutoff', v_cutoff
  );
end;
$$;

comment on function public.purge_old_security_login_logs() is
  'Deletes security_login_attempts older than 90 days and expired CAPTCHA sessions older than 7 days.';

-- ---------------------------------------------------------------------------
-- record_login_attempt: add suspicious success alerts
-- ---------------------------------------------------------------------------

create or replace function public.record_login_attempt(
  p_email text,
  p_ip text default null,
  p_user_agent text default null,
  p_success boolean default false,
  p_failure_reason text default null,
  p_user_id uuid default null,
  p_captcha_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_ip text := nullif(trim(coalesce(p_ip, '')), '');
  v_email_failures integer := 0;
  v_ip_failures integer := 0;
  v_captcha_required boolean := false;
  v_captcha_passed boolean := null;
  v_attempt public.security_login_attempts;
  v_profile record;
  v_status jsonb;
begin
  v_status := public.check_login_security(v_email, v_ip);
  v_captcha_required := coalesce((v_status ->> 'captcha_required')::boolean, false);

  if not p_success and coalesce((v_status ->> 'blocked')::boolean, false) then
    return jsonb_build_object(
      'recorded', false,
      'blocked', true,
      'message', 'Demasiados intentos. Intenta de nuevo en 15 minutos.'
    );
  end if;

  if not p_success and v_captcha_required then
    if p_captcha_session_id is null then
      return jsonb_build_object(
        'recorded', false,
        'blocked', false,
        'captcha_required', true,
        'message', 'Completa la verificacion de seguridad para continuar.'
      );
    end if;

    select exists (
      select 1
      from public.login_captcha_sessions session
      where session.id = p_captcha_session_id
        and lower(session.email_attempted) = v_email
        and session.consumed_at is null
        and session.expires_at > now()
        and (session.ip_address is null or v_ip is null or session.ip_address = v_ip)
    ) into v_captcha_passed;

    if not coalesce(v_captcha_passed, false) then
      return jsonb_build_object(
        'recorded', false,
        'blocked', false,
        'captcha_required', true,
        'message', 'La verificacion CAPTCHA expiro o no es valida.'
      );
    end if;

    update public.login_captcha_sessions
    set consumed_at = now()
    where id = p_captcha_session_id;
  end if;

  select * into v_profile
  from public.resolve_login_profile(v_email);

  insert into public.security_login_attempts (
    email_attempted,
    user_id,
    ip_address,
    user_agent,
    success,
    failure_reason,
    captcha_required,
    captcha_passed,
    metadata
  )
  values (
    v_email,
    coalesce(p_user_id, v_profile.profile_id),
    v_ip,
    nullif(trim(coalesce(p_user_agent, '')), ''),
    p_success,
    nullif(trim(coalesce(p_failure_reason, '')), ''),
    v_captcha_required,
    v_captcha_passed,
    jsonb_build_object(
      'profile_role', v_profile.profile_role,
      'user_agent_fingerprint', public.login_security_user_agent_fingerprint(p_user_agent)
    )
  )
  returning * into v_attempt;

  if p_success then
    perform public.maybe_notify_suspicious_successful_login(
      v_attempt.id,
      v_attempt.user_id,
      v_email,
      v_ip,
      v_attempt.user_agent,
      v_profile.profile_role
    );
  else
    select count(*)::integer
    into v_email_failures
    from public.security_login_attempts attempt
    where attempt.success = false
      and lower(attempt.email_attempted) = v_email
      and attempt.created_at >= now() - make_interval(mins => public.login_security_window_minutes());

    if v_ip is not null then
      select count(*)::integer
      into v_ip_failures
      from public.security_login_attempts attempt
      where attempt.success = false
        and attempt.ip_address = v_ip
        and attempt.created_at >= now() - make_interval(mins => public.login_security_window_minutes());
    end if;

    perform public.maybe_notify_login_security(
      v_attempt.id,
      v_email,
      v_ip,
      v_email_failures,
      v_ip_failures,
      false,
      v_profile.profile_role
    );
  end if;

  v_status := public.check_login_security(v_email, v_ip);

  return jsonb_build_object(
    'recorded', true,
    'attempt_id', v_attempt.id,
    'blocked', coalesce((v_status ->> 'blocked')::boolean, false),
    'captcha_required', coalesce((v_status ->> 'captcha_required')::boolean, false),
    'message', v_status ->> 'message',
    'email_failures', v_status -> 'email_failures',
    'ip_failures', v_status -> 'ip_failures'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Index for suspicious-login lookups
-- ---------------------------------------------------------------------------

create index if not exists security_login_attempts_user_success_idx
  on public.security_login_attempts (user_id, created_at desc)
  where success = true;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.login_security_retention_days() from public;
revoke all on function public.login_security_suspicious_dedup_minutes() from public;
revoke all on function public.login_security_user_agent_fingerprint(text) from public;
revoke all on function public.login_security_is_unusual_hour(timestamptz) from public;
revoke all on function public.maybe_notify_suspicious_successful_login(uuid, uuid, text, text, text, text) from public;
revoke all on function public.purge_old_security_login_logs() from public;

grant execute on function public.purge_old_security_login_logs() to service_role;

-- ---------------------------------------------------------------------------
-- Optional pg_cron schedule (run manually after enabling pg_cron extension)
-- ---------------------------------------------------------------------------
-- select cron.schedule(
--   'purge-security-login-logs-daily',
--   '0 4 * * *',
--   $$select public.purge_old_security_login_logs();$$
-- );
