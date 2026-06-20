-- Single-result checklist audit JSON
SELECT jsonb_build_object(
  'audited_at_utc', now(),
  'operational_context', jsonb_build_object(
    'operational_date', public.get_checklist_operational_date(now()),
    'calendar_date_gt', (now() AT TIME ZONE 'America/Guatemala')::date,
    'weekday_isodow', extract(isodow from public.get_checklist_operational_date(now()))::int,
    'weekday_name', trim(to_char(public.get_checklist_operational_date(now()), 'TMDay'))
  ),
  'runs_for_operational_date', (
    SELECT jsonb_build_object(
      'operational_date', public.get_checklist_operational_date(now()),
      'total_non_cancelled', count(*) FILTER (WHERE status <> 'cancelled'),
      'pending', count(*) FILTER (WHERE status = 'pending'),
      'in_progress', count(*) FILTER (WHERE status = 'in_progress'),
      'completed', count(*) FILTER (WHERE status = 'completed'),
      'overdue', count(*) FILTER (WHERE status = 'overdue'),
      'pending_review', count(*) FILTER (WHERE status = 'pending_review'),
      'rejected', count(*) FILTER (WHERE status = 'rejected'),
      'cancelled', count(*) FILTER (WHERE status = 'cancelled')
    )
    FROM public.checklist_runs
    WHERE run_date = public.get_checklist_operational_date(now())
  ),
  'runs_for_date_candidates', (
    WITH candidates AS (
      SELECT public.get_checklist_operational_date(now()) AS d
      UNION SELECT (now() AT TIME ZONE 'America/Guatemala')::date
      UNION SELECT public.get_checklist_operational_date(now()) - 1
    )
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'run_date', c.d,
        'total_non_cancelled', (
          SELECT count(*) FROM public.checklist_runs r
          WHERE r.run_date = c.d AND r.status <> 'cancelled'
        ),
        'pending', (
          SELECT count(*) FROM public.checklist_runs r
          WHERE r.run_date = c.d AND r.status = 'pending'
        ),
        'in_progress', (
          SELECT count(*) FROM public.checklist_runs r
          WHERE r.run_date = c.d AND r.status = 'in_progress'
        ),
        'completed', (
          SELECT count(*) FROM public.checklist_runs r
          WHERE r.run_date = c.d AND r.status = 'completed'
        ),
        'overdue', (
          SELECT count(*) FROM public.checklist_runs r
          WHERE r.run_date = c.d AND r.status = 'overdue'
        )
      ) ORDER BY c.d DESC
    ), '[]'::jsonb)
    FROM candidates c
  ),
  'templates_due_today', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'frequency', t.frequency,
      'auto_generate', t.auto_generate,
      'recurrence_days', t.recurrence_days
    ) ORDER BY t.title), '[]'::jsonb)
    FROM public.checklist_templates t
    WHERE t.status = 'active'
      AND public.checklist_template_should_auto_generate(t)
      AND public.checklist_template_due_on_date(t, public.get_checklist_operational_date(now()))
  ),
  'active_templates_detail', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'frequency', t.frequency,
      'auto_generate', t.auto_generate,
      'recurrence_days', t.recurrence_days,
      'should_auto_generate', public.checklist_template_should_auto_generate(t),
      'due_today', public.checklist_template_due_on_date(t, public.get_checklist_operational_date(now())),
      'last_run_date', (
        SELECT max(r.run_date)
        FROM public.checklist_runs r
        WHERE r.template_id = t.id AND r.status <> 'cancelled'
      ),
      'last_run_status', (
        SELECT r.status
        FROM public.checklist_runs r
        WHERE r.template_id = t.id AND r.status <> 'cancelled'
        ORDER BY r.run_date DESC, r.created_at DESC
        LIMIT 1
      ),
      'runs_on_operational_date', (
        SELECT count(*)
        FROM public.checklist_runs r
        WHERE r.template_id = t.id
          AND r.run_date = public.get_checklist_operational_date(now())
          AND r.status <> 'cancelled'
      ),
      'next_expected_date', CASE
        WHEN t.frequency = 'diaria' THEN public.get_checklist_operational_date(now())
        WHEN t.frequency IN ('apertura', 'cierre', 'por_turno') THEN public.get_checklist_operational_date(now())
        WHEN t.frequency = 'manual' AND coalesce(t.auto_generate, false) THEN public.get_checklist_operational_date(now())
        WHEN t.frequency = 'semanal' THEN (
          SELECT min(d)::date
          FROM generate_series(public.get_checklist_operational_date(now()), public.get_checklist_operational_date(now()) + 13, interval '1 day') d
          WHERE extract(isodow from d)::int = ANY(coalesce(t.recurrence_days, ARRAY[]::integer[]))
        )
        WHEN t.frequency = 'mensual' THEN (
          SELECT (date_trunc('month', public.get_checklist_operational_date(now())) + (coalesce(t.recurrence_month_day, 1) - 1) * interval '1 day')::date
          + CASE
            WHEN (date_trunc('month', public.get_checklist_operational_date(now())) + (coalesce(t.recurrence_month_day, 1) - 1) * interval '1 day')::date < public.get_checklist_operational_date(now())
            THEN interval '1 month' ELSE interval '0 day' END
        )
        ELSE NULL
      END
    ) ORDER BY t.title), '[]'::jsonb)
    FROM public.checklist_templates t
    WHERE t.status = 'active'
  ),
  'recent_active_runs_by_date', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'run_date', x.run_date,
      'status', x.status,
      'count', x.cnt
    ) ORDER BY x.run_date DESC, x.status), '[]'::jsonb)
    FROM (
      SELECT run_date, status, count(*) AS cnt
      FROM public.checklist_runs
      WHERE status IN ('pending', 'in_progress', 'overdue', 'rejected', 'pending_review')
        AND run_date >= public.get_checklist_operational_date(now()) - 7
      GROUP BY run_date, status
    ) x
  ),
  'generate_eligibility_today', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'title', t.title,
      'frequency', t.frequency,
      'auto_generate', t.auto_generate,
      'passes_should_auto', public.checklist_template_should_auto_generate(t),
      'passes_due_on_date', public.checklist_template_due_on_date(t, public.get_checklist_operational_date(now())),
      'already_has_run_today', EXISTS (
        SELECT 1 FROM public.checklist_runs r
        WHERE r.template_id = t.id
          AND r.run_date = public.get_checklist_operational_date(now())
          AND r.status <> 'cancelled'
      ),
      'generate_action', CASE
        WHEN t.status <> 'active' THEN 'template_inactive'
        WHEN NOT public.checklist_template_should_auto_generate(t) THEN 'should_auto_generate_false'
        WHEN NOT public.checklist_template_due_on_date(t, public.get_checklist_operational_date(now())) THEN 'not_due_on_operational_date'
        WHEN EXISTS (
          SELECT 1 FROM public.checklist_runs r
          WHERE r.template_id = t.id
            AND r.run_date = public.get_checklist_operational_date(now())
            AND r.status <> 'cancelled'
        ) THEN 'would_return_existing_run'
        ELSE 'would_create_new_run'
      END
    ) ORDER BY t.title), '[]'::jsonb)
    FROM public.checklist_templates t
    WHERE t.status = 'active'
  ),
  'generate_simulation_now', (
    SELECT count(*)
    FROM public.checklist_templates t
    WHERE t.status = 'active'
      AND public.checklist_template_should_auto_generate(t)
      AND public.checklist_template_due_on_date(t, public.get_checklist_operational_date(now()))
  )
) AS audit;
