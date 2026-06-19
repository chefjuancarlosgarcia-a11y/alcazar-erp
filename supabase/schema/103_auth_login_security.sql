-- Login brute-force protection, audit trail, and 2FA preparation.
-- Apply after 102_catering_update_request.sql.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.security_login_attempts (
  id uuid primary key default gen_random_uuid(),
  email_attempted text not null,
  user_id uuid references public.profiles(id) on delete set null,
  ip_address text,
  user_agent text,
  success boolean not null default false,
  failure_reason text,
  captcha_required boolean not null default false,
  captcha_passed boolean,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists security_login_attempts_email_created_idx
  on public.security_login_attempts (lower(email_attempted), created_at desc);

create index if not exists security_login_attempts_ip_created_idx
  on public.security_login_attempts (ip_address, created_at desc)
  where ip_address is not null;

create index if not exists security_login_attempts_created_idx
  on public.security_login_attempts (created_at desc);

create table if not exists public.login_captcha_sessions (
  id uuid primary key default gen_random_uuid(),
  email_attempted text not null,
  ip_address text,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  consumed_at timestamptz
);

create index if not exists login_captcha_sessions_lookup_idx
  on public.login_captcha_sessions (lower(email_attempted), expires_at desc);

comment on table public.login_captcha_sessions is
  'Short-lived CAPTCHA verification sessions created after Cloudflare Turnstile validation.';

-- Future 2FA (not enforced yet).
create table if not exists public.profile_mfa_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  mfa_required boolean not null default false,
  mfa_enabled boolean not null default false,
  preferred_method text
    check (preferred_method is null or preferred_method in ('totp', 'sms', 'email')),
  totp_secret_encrypted text,
  backup_codes_hash text[],
  enforced_by_role boolean not null default false,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profile_mfa_settings is
  'Reserved for phase-2 mandatory 2FA on privileged roles (admin, gerencia, RRHH, finanzas).';

alter table public.security_login_attempts enable row level security;
alter table public.login_captcha_sessions enable row level security;
alter table public.profile_mfa_settings enable row level security;

grant select on public.security_login_attempts to authenticated;
grant all on public.security_login_attempts, public.login_captcha_sessions, public.profile_mfa_settings to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_login_security_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.status = 'active'
      and public.normalize_profile_role(profile.role) in ('admin', 'gerente_general')
  );
$$;

create or replace function public.login_security_sensitive_roles()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'admin',
    'gerente_general',
    'recursos_humanos',
    'rrhh',
    'finanzas'
  ]::text[];
$$;

create or replace function public.login_security_window_minutes()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 15;
$$;

create or replace function public.count_failed_login_attempts(
  p_email text default null,
  p_ip text default null
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.security_login_attempts attempt
  where attempt.success = false
    and attempt.created_at >= now() - make_interval(mins => public.login_security_window_minutes())
    and (
      (p_email is not null and lower(attempt.email_attempted) = lower(trim(p_email)))
      or (p_ip is not null and nullif(trim(p_ip), '') is not null and attempt.ip_address = nullif(trim(p_ip), ''))
    );
$$;

create or replace function public.resolve_login_profile(p_email text)
returns table (
  profile_id uuid,
  profile_role text
)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id, public.normalize_profile_role(profile.role)
  from public.profiles profile
  where lower(trim(coalesce(profile.email, ''))) = lower(trim(coalesce(p_email, '')))
  limit 1;
$$;

create or replace function public.create_login_security_notification(
  p_type text,
  p_title text,
  p_message text,
  p_entity_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role text;
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
        and notification.created_at >= now() - make_interval(mins => public.login_security_window_minutes())
    );
  end loop;
end;
$$;

create or replace function public.maybe_notify_login_security(
  p_attempt_id uuid,
  p_email text,
  p_ip text,
  p_email_failures integer,
  p_ip_failures integer,
  p_success boolean,
  p_profile_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sensitive boolean := p_profile_role = any(public.login_security_sensitive_roles());
begin
  if p_email_failures >= 5 then
    perform public.create_login_security_notification(
      'login_bruteforce_email',
      'Intentos fallidos de login',
      format('El correo %s acumulo %s intentos fallidos en %s minutos.', p_email, p_email_failures, public.login_security_window_minutes()),
      lower(trim(p_email))
    );
  end if;

  if p_ip_failures > 10 then
    perform public.create_login_security_notification(
      'login_bruteforce_ip',
      'IP con intentos fallidos de login',
      format('La IP %s acumulo %s intentos fallidos en %s minutos.', coalesce(p_ip, 'desconocida'), p_ip_failures, public.login_security_window_minutes()),
      coalesce(p_ip, 'unknown')
    );
  end if;

  if not p_success and v_sensitive then
    perform public.create_login_security_notification(
      'login_sensitive_account',
      'Intento fallido en cuenta sensible',
      format('Se intento acceder a la cuenta %s (rol %s).', p_email, coalesce(p_profile_role, 'desconocido')),
      p_attempt_id::text
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: check_login_security (anonymous pre-login)
-- ---------------------------------------------------------------------------

create or replace function public.check_login_security(
  p_email text,
  p_ip text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_ip text := nullif(trim(coalesce(p_ip, '')), '');
  v_email_failures integer := 0;
  v_ip_failures integer := 0;
  v_blocked boolean := false;
  v_captcha_required boolean := false;
begin
  if v_email = '' then
    return jsonb_build_object(
      'allowed', false,
      'blocked', true,
      'captcha_required', false,
      'message', 'Ingresa un correo valido.',
      'email_failures', 0,
      'ip_failures', 0
    );
  end if;

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

  v_blocked := v_email_failures >= 5 or v_ip_failures >= 10;
  v_captcha_required := not v_blocked and v_email_failures >= 3 and v_email_failures < 5;

  return jsonb_build_object(
    'allowed', not v_blocked,
    'blocked', v_blocked,
    'captcha_required', v_captcha_required,
    'message', case
      when v_blocked then 'Demasiados intentos. Intenta de nuevo en 15 minutos.'
      when v_captcha_required then 'Completa la verificacion de seguridad para continuar.'
      else null
    end,
    'email_failures', v_email_failures,
    'ip_failures', v_ip_failures
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: create_login_captcha_session (service role / edge function)
-- ---------------------------------------------------------------------------

create or replace function public.create_login_captcha_session(
  p_email text,
  p_ip text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.login_captcha_sessions;
begin
  insert into public.login_captcha_sessions (email_attempted, ip_address)
  values (lower(trim(coalesce(p_email, ''))), nullif(trim(coalesce(p_ip, '')), ''))
  returning * into v_row;

  return v_row.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: record_login_attempt (anonymous post-login)
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
      'profile_role', v_profile.profile_role
    )
  )
  returning * into v_attempt;

  if not p_success then
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
-- RPC: audit dashboard
-- ---------------------------------------------------------------------------

create or replace function public.get_security_login_attempts(
  p_limit integer default 100,
  p_offset integer default 0,
  p_email text default null,
  p_success boolean default null
)
returns table (
  id uuid,
  email_attempted text,
  user_id uuid,
  ip_address text,
  user_agent text,
  success boolean,
  failure_reason text,
  captcha_required boolean,
  captcha_passed boolean,
  profile_role text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_login_security_admin() then
    raise exception 'No tienes permiso para ver intentos de login.';
  end if;

  return query
  select
    attempt.id,
    attempt.email_attempted,
    attempt.user_id,
    attempt.ip_address,
    attempt.user_agent,
    attempt.success,
    attempt.failure_reason,
    attempt.captcha_required,
    attempt.captcha_passed,
    coalesce(attempt.metadata ->> 'profile_role', profile.role) as profile_role,
    attempt.created_at
  from public.security_login_attempts attempt
  left join public.profiles profile on profile.id = attempt.user_id
  where (p_email is null or lower(attempt.email_attempted) like '%' || lower(trim(p_email)) || '%')
    and (p_success is null or attempt.success = p_success)
  order by attempt.created_at desc
  limit greatest(coalesce(p_limit, 100), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

drop policy if exists security_login_attempts_admin_select on public.security_login_attempts;
create policy security_login_attempts_admin_select
  on public.security_login_attempts
  for select
  to authenticated
  using (public.is_login_security_admin());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.is_login_security_admin() from public;
revoke all on function public.login_security_sensitive_roles() from public;
revoke all on function public.login_security_window_minutes() from public;
revoke all on function public.count_failed_login_attempts(text, text) from public;
revoke all on function public.resolve_login_profile(text) from public;
revoke all on function public.create_login_security_notification(text, text, text, text) from public;
revoke all on function public.maybe_notify_login_security(uuid, text, text, integer, integer, boolean, text) from public;
revoke all on function public.check_login_security(text, text) from public;
revoke all on function public.create_login_captcha_session(text, text) from public;
revoke all on function public.record_login_attempt(text, text, text, boolean, text, uuid, uuid) from public;
revoke all on function public.get_security_login_attempts(integer, integer, text, boolean) from public;

grant execute on function public.check_login_security(text, text) to anon, authenticated;
grant execute on function public.record_login_attempt(text, text, text, boolean, text, uuid, uuid) to anon, authenticated;
grant execute on function public.get_security_login_attempts(integer, integer, text, boolean) to authenticated;
grant execute on function public.create_login_captcha_session(text, text) to service_role;
