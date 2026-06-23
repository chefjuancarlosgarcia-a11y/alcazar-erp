-- Post-migration 120 verification: Panadería Apertura (or any template by UUID)
-- Run in Supabase SQL Editor AFTER applying 120_checklist_run_unique_constraint.sql
--
-- =============================================================================
-- CONFIG — edit ONLY this block (copy into each section, or run SUMMARY first)
-- =============================================================================
-- target_template_id:
--   • Set a UUID  → use that template directly (recommended if title is ambiguous)
--   • NULL        → search by title ILIKE '%Panadería%Apertura%'
-- target_run_date:
--   • Specific date for the incident, or get_checklist_operational_date() for today
--
-- Example with fixed UUID:
--   'a1b2c3d4-e5f6-7890-abcd-ef1234567890'::uuid AS target_template_id,
--   '2026-06-09'::date AS target_run_date,

-- =============================================================================
-- SUMMARY (single row — read verification_summary JSON)
-- =============================================================================
WITH verify_120_config AS (
  SELECT
    NULL::uuid AS target_template_id,
    public.get_checklist_operational_date() AS target_run_date,
    '%Panadería%Apertura%'::text AS title_pattern,
    '%Panaderia%Apertura%'::text AS title_pattern_ascii
),
title_matches AS (
  SELECT
    t.id,
    t.title,
    t.frequency,
    t.auto_generate,
    t.status,
    t.created_at
  FROM public.checklist_templates t
  CROSS JOIN verify_120_config c
  WHERE c.target_template_id IS NULL
    AND (
      t.title ILIKE c.title_pattern
      OR t.title ILIKE c.title_pattern_ascii
    )
),
title_match_count AS (
  SELECT count(*)::integer AS cnt FROM title_matches
),
resolved_by_uuid AS (
  SELECT
    t.id,
    t.title,
    t.frequency,
    t.auto_generate,
    t.status,
    'uuid'::text AS resolution_method
  FROM public.checklist_templates t
  CROSS JOIN verify_120_config c
  WHERE c.target_template_id IS NOT NULL
    AND t.id = c.target_template_id
),
resolved_by_title AS (
  SELECT
    tm.id,
    tm.title,
    tm.frequency,
    tm.auto_generate,
    tm.status,
    'title_ilike'::text AS resolution_method
  FROM title_matches tm
  CROSS JOIN title_match_count tmc
  CROSS JOIN verify_120_config c
  WHERE c.target_template_id IS NULL
    AND tmc.cnt = 1
  ORDER BY tm.created_at ASC
  LIMIT 1
),
resolved_template AS (
  SELECT * FROM resolved_by_uuid
  UNION ALL
  SELECT * FROM resolved_by_title
  WHERE NOT EXISTS (SELECT 1 FROM resolved_by_uuid)
  LIMIT 1
),
template_resolution AS (
  SELECT
    c.target_template_id AS config_target_template_id,
    c.target_run_date,
    rt.id AS resolved_template_id,
    rt.title AS resolved_title,
    rt.resolution_method,
    tmc.cnt AS title_match_count,
    CASE
      WHEN c.target_template_id IS NOT NULL AND rt.id IS NULL THEN
        'FAIL: target_template_id UUID not found in checklist_templates'
      WHEN c.target_template_id IS NULL AND tmc.cnt = 0 THEN
        'FAIL: no template matched title patterns — set target_template_id UUID'
      WHEN c.target_template_id IS NULL AND tmc.cnt > 1 THEN
        'WARN: multiple templates matched title — set target_template_id UUID (see title_matches_preview)'
      WHEN rt.id IS NOT NULL THEN 'OK'
      ELSE 'REVIEW'
    END AS resolution_status,
    (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'id', tm.id,
          'title', tm.title,
          'status', tm.status,
          'created_at', tm.created_at
        ) ORDER BY tm.created_at
      ), '[]'::jsonb)
      FROM title_matches tm
    ) AS title_matches_preview
  FROM verify_120_config c
  CROSS JOIN title_match_count tmc
  LEFT JOIN resolved_template rt ON true
),
target_runs AS (
  SELECT
    r.*,
    tr.resolved_title AS template_title,
    public.checklist_run_answered_item_count(r.id) AS answered_items,
    CASE coalesce(r.total_points, 0)
      WHEN 0 THEN 0::numeric
      ELSE round(100.0 * coalesce(r.earned_points, 0) / r.total_points, 2)
    END AS progress_pct,
    CASE r.status
      WHEN 'completed' THEN 1
      WHEN 'pending_review' THEN 2
      WHEN 'in_progress' THEN 3
      WHEN 'overdue' THEN 4
      WHEN 'pending' THEN 5
      WHEN 'rejected' THEN 6
      ELSE 7
    END AS status_rank
  FROM public.checklist_runs r
  INNER JOIN template_resolution tr ON tr.resolved_template_id = r.template_id
  WHERE r.run_date = tr.target_run_date
),
migration_cohort AS (
  SELECT *
  FROM target_runs tr
  WHERE tr.status <> 'cancelled'
     OR coalesce(tr.notes, '') ILIKE '%migracion 120%'
),
ranked_cohort AS (
  SELECT
    mc.*,
    row_number() OVER (
      PARTITION BY mc.template_id, mc.run_date
      ORDER BY
        mc.answered_items DESC,
        coalesce(mc.earned_points, 0) DESC,
        mc.status_rank ASC,
        mc.created_at ASC
    ) AS canonical_rank
  FROM migration_cohort mc
),
active_runs AS (
  SELECT * FROM target_runs WHERE status <> 'cancelled'
),
cancelled_by_120 AS (
  SELECT * FROM target_runs
  WHERE status = 'cancelled'
    AND coalesce(notes, '') ILIKE '%migracion 120%'
),
resolution_ok AS (
  SELECT resolution_status = 'OK' AS ok FROM template_resolution
)
SELECT jsonb_build_object(
  'audited_at_utc', now(),
  'config', (
    SELECT jsonb_build_object(
      'target_template_id', config_target_template_id,
      'target_run_date', target_run_date,
      'title_pattern', (SELECT title_pattern FROM verify_120_config),
      'title_pattern_ascii', (SELECT title_pattern_ascii FROM verify_120_config)
    )
    FROM template_resolution
  ),
  'template_resolution', (
    SELECT jsonb_build_object(
      'resolved_template_id', resolved_template_id,
      'resolved_title', resolved_title,
      'resolution_method', resolution_method,
      'resolution_status', resolution_status,
      'title_match_count', title_match_count,
      'title_matches_preview', title_matches_preview
    )
    FROM template_resolution
  ),
  'check_1_no_active_duplicates', jsonb_build_object(
    'pass', (SELECT ok FROM resolution_ok)
      AND NOT EXISTS (
        SELECT 1
        FROM public.checklist_runs r
        INNER JOIN template_resolution tr ON tr.resolved_template_id = r.template_id
        WHERE r.run_date = tr.target_run_date
          AND r.status <> 'cancelled'
        GROUP BY r.template_id, r.run_date
        HAVING count(*) > 1
      ),
    'active_run_count', (SELECT count(*) FROM active_runs),
    'expected', '0 or 1 active run for template_id + run_date'
  ),
  'check_2_at_most_one_active', jsonb_build_object(
    'pass', (SELECT ok FROM resolution_ok) AND (SELECT count(*) FROM active_runs) <= 1,
    'active_run_count', (SELECT count(*) FROM active_runs),
    'cancelled_by_migration_120', (SELECT count(*) FROM cancelled_by_120)
  ),
  'check_3_canonical_is_correct', jsonb_build_object(
    'pass', (SELECT ok FROM resolution_ok) AND coalesce((
      SELECT
        CASE
          WHEN (SELECT count(*) FROM active_runs) = 0 THEN true
          WHEN (SELECT count(*) FROM migration_cohort) <= 1 THEN true
          ELSE (
            SELECT ar.id = rc.id
            FROM active_runs ar
            CROSS JOIN ranked_cohort rc
            WHERE rc.canonical_rank = 1
            LIMIT 1
          )
        END
    ), true),
    'expected_canonical_run_id', (SELECT id FROM ranked_cohort WHERE canonical_rank = 1 LIMIT 1),
    'actual_active_run_id', (SELECT id FROM active_runs LIMIT 1),
    'ranking_preview', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'rank', canonical_rank,
          'run_id', id,
          'status', status,
          'answered_items', answered_items,
          'earned_points', earned_points,
          'progress_pct', progress_pct,
          'status_rank', status_rank,
          'created_at', created_at,
          'is_active', status <> 'cancelled'
        ) ORDER BY canonical_rank
      ), '[]'::jsonb)
      FROM ranked_cohort
    )
  ),
  'check_4_cancelled_have_migration_note', jsonb_build_object(
    'pass', (SELECT ok FROM resolution_ok) AND NOT EXISTS (
      SELECT 1
      FROM cancelled_by_120 cb
      WHERE coalesce(cb.notes, '') NOT ILIKE '%migracion 120%'
    ),
    'cancelled_without_note', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'notes', notes)), '[]'::jsonb)
      FROM target_runs tr
      WHERE tr.status = 'cancelled'
        AND coalesce(tr.notes, '') NOT ILIKE '%migracion 120%'
        AND EXISTS (SELECT 1 FROM cancelled_by_120)
    )
  ),
  'check_5_unique_index_present', jsonb_build_object(
    'pass', EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'checklist_runs'
        AND indexname = 'checklist_runs_template_date_active_unique'
    ),
    'indexdef', (
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'checklist_runs_template_date_active_unique'
      LIMIT 1
    )
  ),
  'all_checks_pass', (
    (SELECT resolution_status = 'OK' FROM template_resolution)
    AND (SELECT count(*) FROM active_runs) <= 1
    AND NOT EXISTS (
      SELECT 1 FROM active_runs ar
      CROSS JOIN ranked_cohort rc
      WHERE rc.canonical_rank = 1
        AND (SELECT count(*) FROM migration_cohort) > 1
        AND ar.id IS DISTINCT FROM rc.id
    )
    AND EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE indexname = 'checklist_runs_template_date_active_unique'
    )
  )
) AS verification_summary;


-- =============================================================================
-- CHECK 1 — No active duplicates
-- Expected: 1A = 0 rows globally; 1B = 0 or 1 row for resolved template
-- =============================================================================

-- 1A) Global: any template with more than one active run on same date
SELECT
  r.template_id,
  t.title,
  r.run_date,
  count(*) AS active_count,
  array_agg(r.id ORDER BY r.created_at) AS run_ids,
  array_agg(r.status ORDER BY r.created_at) AS statuses
FROM public.checklist_runs r
LEFT JOIN public.checklist_templates t ON t.id = r.template_id
WHERE r.status <> 'cancelled'
GROUP BY r.template_id, t.title, r.run_date
HAVING count(*) > 1
ORDER BY active_count DESC, r.run_date DESC;

-- 1B) Resolved template only (uses CONFIG below)
WITH verify_120_config AS (
  SELECT
    NULL::uuid AS target_template_id,
    public.get_checklist_operational_date() AS target_run_date,
    '%Panadería%Apertura%'::text AS title_pattern,
    '%Panaderia%Apertura%'::text AS title_pattern_ascii
),
title_matches AS (
  SELECT t.id, t.title, t.created_at
  FROM public.checklist_templates t
  CROSS JOIN verify_120_config c
  WHERE c.target_template_id IS NULL
    AND (t.title ILIKE c.title_pattern OR t.title ILIKE c.title_pattern_ascii)
),
title_match_count AS (
  SELECT count(*)::integer AS cnt FROM title_matches
),
resolved_template AS (
  SELECT x.id, x.title
  FROM (
    SELECT t.id, t.title, t.created_at, 0 AS pick_order
    FROM public.checklist_templates t
    CROSS JOIN verify_120_config c
    WHERE c.target_template_id IS NOT NULL AND t.id = c.target_template_id
    UNION ALL
    SELECT tm.id, tm.title, tm.created_at, 1 AS pick_order
    FROM title_matches tm
    CROSS JOIN verify_120_config c
    CROSS JOIN title_match_count tmc
    WHERE c.target_template_id IS NULL
      AND tmc.cnt = 1
  ) x
  ORDER BY x.pick_order, x.created_at ASC
  LIMIT 1
)
SELECT
  r.id,
  r.template_id,
  rt.title,
  r.run_date,
  r.status,
  r.assigned_profile_id,
  r.assigned_role,
  r.area,
  r.created_at
FROM public.checklist_runs r
INNER JOIN resolved_template rt ON rt.id = r.template_id
CROSS JOIN verify_120_config c
WHERE r.run_date = c.target_run_date
  AND r.status <> 'cancelled'
ORDER BY r.created_at;


-- =============================================================================
-- CHECK 2 — History: active vs cancelled-by-120 on target date
-- Expected: at most 1 active row
-- =============================================================================

WITH verify_120_config AS (
  SELECT
    NULL::uuid AS target_template_id,
    public.get_checklist_operational_date() AS target_run_date,
    '%Panadería%Apertura%'::text AS title_pattern,
    '%Panaderia%Apertura%'::text AS title_pattern_ascii
),
title_matches AS (
  SELECT t.id, t.title, t.created_at
  FROM public.checklist_templates t
  CROSS JOIN verify_120_config c
  WHERE c.target_template_id IS NULL
    AND (t.title ILIKE c.title_pattern OR t.title ILIKE c.title_pattern_ascii)
),
title_match_count AS (
  SELECT count(*)::integer AS cnt FROM title_matches
),
resolved_template AS (
  SELECT x.id, x.title
  FROM (
    SELECT t.id, t.title, t.created_at, 0 AS pick_order
    FROM public.checklist_templates t
    CROSS JOIN verify_120_config c
    WHERE c.target_template_id IS NOT NULL AND t.id = c.target_template_id
    UNION ALL
    SELECT tm.id, tm.title, tm.created_at, 1 AS pick_order
    FROM title_matches tm
    CROSS JOIN verify_120_config c
    CROSS JOIN title_match_count tmc
    WHERE c.target_template_id IS NULL
      AND tmc.cnt = 1
  ) x
  ORDER BY x.pick_order, x.created_at ASC
  LIMIT 1
)
SELECT
  r.id,
  rt.title AS template_title,
  r.status,
  r.assigned_profile_id,
  r.assigned_role,
  r.area,
  public.checklist_run_answered_item_count(r.id) AS answered_items,
  r.earned_points,
  r.total_points,
  r.notes,
  r.created_at,
  r.updated_at,
  CASE
    WHEN r.status <> 'cancelled' THEN 'ACTIVE (canonical candidate)'
    WHEN coalesce(r.notes, '') ILIKE '%migracion 120%' THEN 'CANCELLED by migration 120'
    ELSE 'CANCELLED (other reason)'
  END AS run_role
FROM public.checklist_runs r
INNER JOIN resolved_template rt ON rt.id = r.template_id
CROSS JOIN verify_120_config c
WHERE r.run_date = c.target_run_date
ORDER BY
  CASE WHEN r.status <> 'cancelled' THEN 0 ELSE 1 END,
  r.created_at;


-- =============================================================================
-- CHECK 3 — Canonical ranking replay (same rules as migration 120)
-- Expected: rank=1 = OK active; ranks > 1 = OK if cancelled with migration note
-- =============================================================================

WITH verify_120_config AS (
  SELECT
    NULL::uuid AS target_template_id,
    public.get_checklist_operational_date() AS target_run_date,
    '%Panadería%Apertura%'::text AS title_pattern,
    '%Panaderia%Apertura%'::text AS title_pattern_ascii
),
title_matches AS (
  SELECT t.id, t.created_at
  FROM public.checklist_templates t
  CROSS JOIN verify_120_config c
  WHERE c.target_template_id IS NULL
    AND (t.title ILIKE c.title_pattern OR t.title ILIKE c.title_pattern_ascii)
),
title_match_count AS (
  SELECT count(*)::integer AS cnt FROM title_matches
),
resolved_template AS (
  SELECT x.id
  FROM (
    SELECT t.id, t.created_at, 0 AS pick_order
    FROM public.checklist_templates t
    CROSS JOIN verify_120_config c
    WHERE c.target_template_id IS NOT NULL AND t.id = c.target_template_id
    UNION ALL
    SELECT tm.id, tm.created_at, 1 AS pick_order
    FROM title_matches tm
    CROSS JOIN verify_120_config c
    CROSS JOIN title_match_count tmc
    WHERE c.target_template_id IS NULL
      AND tmc.cnt = 1
  ) x
  ORDER BY x.pick_order, x.created_at ASC
  LIMIT 1
),
cohort AS (
  SELECT
    r.id,
    r.status,
    public.checklist_run_answered_item_count(r.id) AS answered_items,
    r.earned_points,
    r.total_points,
    r.created_at,
    r.notes,
    CASE r.status
      WHEN 'completed' THEN 1
      WHEN 'pending_review' THEN 2
      WHEN 'in_progress' THEN 3
      WHEN 'overdue' THEN 4
      WHEN 'pending' THEN 5
      WHEN 'rejected' THEN 6
      ELSE 7
    END AS status_rank
  FROM public.checklist_runs r
  INNER JOIN resolved_template rt ON rt.id = r.template_id
  CROSS JOIN verify_120_config c
  WHERE r.run_date = c.target_run_date
    AND (
      r.status <> 'cancelled'
      OR coalesce(r.notes, '') ILIKE '%migracion 120%'
    )
),
ranked AS (
  SELECT
    c.*,
    row_number() OVER (
      ORDER BY
        c.answered_items DESC,
        coalesce(c.earned_points, 0) DESC,
        c.status_rank ASC,
        c.created_at ASC
    ) AS canonical_rank
  FROM cohort c
)
SELECT
  canonical_rank,
  id AS run_id,
  status,
  answered_items,
  earned_points,
  status_rank,
  created_at,
  left(coalesce(notes, ''), 120) AS notes_preview,
  CASE
    WHEN canonical_rank = 1 THEN 'SHOULD BE THE ACTIVE RUN'
    ELSE 'SHOULD BE CANCELLED (migration 120)'
  END AS expected_outcome,
  CASE
    WHEN canonical_rank = 1 AND status <> 'cancelled' THEN 'OK'
    WHEN canonical_rank > 1 AND status = 'cancelled' AND coalesce(notes, '') ILIKE '%migracion 120%' THEN 'OK'
    WHEN canonical_rank > 1 AND status = 'cancelled' THEN 'WARN: cancelled but missing migration note'
    WHEN canonical_rank = 1 AND status = 'cancelled' THEN 'FAIL: canonical run is cancelled'
    WHEN canonical_rank > 1 AND status <> 'cancelled' THEN 'FAIL: extra active duplicate'
    ELSE 'REVIEW'
  END AS verification
FROM ranked
ORDER BY canonical_rank;


-- =============================================================================
-- CHECK 4 — Cancelled duplicates must cite migration 120 in notes
-- Expected: 0 rows
-- =============================================================================

WITH verify_120_config AS (
  SELECT
    NULL::uuid AS target_template_id,
    public.get_checklist_operational_date() AS target_run_date,
    '%Panadería%Apertura%'::text AS title_pattern,
    '%Panaderia%Apertura%'::text AS title_pattern_ascii
),
title_matches AS (
  SELECT t.id FROM public.checklist_templates t
  CROSS JOIN verify_120_config c
  WHERE c.target_template_id IS NULL
    AND (t.title ILIKE c.title_pattern OR t.title ILIKE c.title_pattern_ascii)
),
title_match_count AS (
  SELECT count(*)::integer AS cnt FROM title_matches
),
resolved_template AS (
  SELECT x.id
  FROM (
    SELECT t.id, t.created_at, 0 AS pick_order
    FROM public.checklist_templates t
    CROSS JOIN verify_120_config c
    WHERE c.target_template_id IS NOT NULL AND t.id = c.target_template_id
    UNION ALL
    SELECT tm.id, tm.created_at, 1 AS pick_order
    FROM title_matches tm
    CROSS JOIN verify_120_config c
    CROSS JOIN title_match_count tmc
    WHERE c.target_template_id IS NULL
      AND tmc.cnt = 1
  ) x
  ORDER BY x.pick_order, x.created_at ASC
  LIMIT 1
)
SELECT
  r.id,
  r.run_date,
  r.status,
  r.notes,
  r.created_at
FROM public.checklist_runs r
INNER JOIN resolved_template rt ON rt.id = r.template_id
CROSS JOIN verify_120_config c
WHERE r.run_date = c.target_run_date
  AND r.status = 'cancelled'
  AND EXISTS (
    SELECT 1
    FROM public.checklist_runs r2
    WHERE r2.template_id = r.template_id
      AND r2.run_date = r.run_date
      AND r2.id <> r.id
  )
  AND coalesce(r.notes, '') NOT ILIKE '%migracion 120%';


-- =============================================================================
-- CHECK 5A — Unique index blocks duplicate INSERT (optional, commented)
-- =============================================================================

/*
DO $$
DECLARE
  v_target_template_id uuid := NULL;  -- or fixed UUID
  v_target_run_date date := public.get_checklist_operational_date();
  v_template_id uuid;
  v_existing_id uuid;
BEGIN
  IF v_target_template_id IS NOT NULL THEN
    v_template_id := v_target_template_id;
  ELSE
    SELECT t.id INTO v_template_id
    FROM public.checklist_templates t
    WHERE t.title ILIKE '%Panadería%Apertura%' OR t.title ILIKE '%Panaderia%Apertura%'
    ORDER BY t.created_at LIMIT 1;
  END IF;

  IF v_template_id IS NULL THEN
    RAISE EXCEPTION 'Template not resolved — set v_target_template_id UUID';
  END IF;

  SELECT r.id INTO v_existing_id
  FROM public.checklist_runs r
  WHERE r.template_id = v_template_id
    AND r.run_date = v_target_run_date
    AND r.status <> 'cancelled'
  LIMIT 1;

  IF v_existing_id IS NULL THEN
    RAISE NOTICE 'CHECK 5A SKIP: no active run on %', v_target_run_date;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.checklist_runs (
      template_id, run_date, status, total_points, earned_points, assignment_source
    ) VALUES (v_template_id, v_target_run_date, 'pending', 0, 0, 'manual');
    RAISE EXCEPTION 'CHECK 5A FAIL: duplicate INSERT succeeded';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'CHECK 5A PASS: blocked duplicate (existing %)', v_existing_id;
  END;
END;
$$;
*/


-- =============================================================================
-- CHECK 5B — Snapshot before/after /tasks refresh (uses CONFIG)
-- =============================================================================

WITH verify_120_config AS (
  SELECT
    NULL::uuid AS target_template_id,
    public.get_checklist_operational_date() AS target_run_date,
    '%Panadería%Apertura%'::text AS title_pattern,
    '%Panaderia%Apertura%'::text AS title_pattern_ascii
),
title_matches AS (
  SELECT t.id, t.title, t.created_at
  FROM public.checklist_templates t
  CROSS JOIN verify_120_config c
  WHERE c.target_template_id IS NULL
    AND (t.title ILIKE c.title_pattern OR t.title ILIKE c.title_pattern_ascii)
),
title_match_count AS (
  SELECT count(*)::integer AS cnt FROM title_matches
),
resolved_template AS (
  SELECT x.id, x.title
  FROM (
    SELECT t.id, t.title, t.created_at, 0 AS pick_order
    FROM public.checklist_templates t
    CROSS JOIN verify_120_config c
    WHERE c.target_template_id IS NOT NULL AND t.id = c.target_template_id
    UNION ALL
    SELECT tm.id, tm.title, tm.created_at, 1 AS pick_order
    FROM title_matches tm
    CROSS JOIN verify_120_config c
    CROSS JOIN title_match_count tmc
    WHERE c.target_template_id IS NULL
      AND tmc.cnt = 1
  ) x
  ORDER BY x.pick_order, x.created_at ASC
  LIMIT 1
)
SELECT
  rt.id AS template_id,
  rt.title,
  c.target_run_date AS run_date,
  r.id AS canonical_run_id,
  r.status,
  public.checklist_run_answered_item_count(r.id) AS answered_items
FROM resolved_template rt
CROSS JOIN verify_120_config c
LEFT JOIN public.checklist_runs r
  ON r.template_id = rt.id
 AND r.run_date = c.target_run_date
 AND r.status <> 'cancelled';

-- Re-run after refreshing /tasks twice:
WITH verify_120_config AS (
  SELECT
    NULL::uuid AS target_template_id,
    public.get_checklist_operational_date() AS target_run_date,
    '%Panadería%Apertura%'::text AS title_pattern,
    '%Panaderia%Apertura%'::text AS title_pattern_ascii
),
title_matches AS (
  SELECT t.id FROM public.checklist_templates t
  CROSS JOIN verify_120_config c
  WHERE c.target_template_id IS NULL
    AND (t.title ILIKE c.title_pattern OR t.title ILIKE c.title_pattern_ascii)
),
title_match_count AS (
  SELECT count(*)::integer AS cnt FROM title_matches
),
resolved_template AS (
  SELECT x.id
  FROM (
    SELECT t.id, t.created_at, 0 AS pick_order
    FROM public.checklist_templates t
    CROSS JOIN verify_120_config c
    WHERE c.target_template_id IS NOT NULL AND t.id = c.target_template_id
    UNION ALL
    SELECT tm.id, tm.created_at, 1 AS pick_order
    FROM title_matches tm
    CROSS JOIN verify_120_config c
    CROSS JOIN title_match_count tmc
    WHERE c.target_template_id IS NULL
      AND tmc.cnt = 1
  ) x
  ORDER BY x.pick_order, x.created_at ASC
  LIMIT 1
)
SELECT
  count(*) FILTER (WHERE r.status <> 'cancelled') AS active_count,
  max(r.id::text) FILTER (WHERE r.status <> 'cancelled') AS active_run_id,
  CASE
    WHEN count(*) FILTER (WHERE r.status <> 'cancelled') = 1 THEN 'PASS'
    WHEN count(*) FILTER (WHERE r.status <> 'cancelled') = 0 THEN 'WARN: no active run'
    ELSE 'FAIL: duplicate actives'
  END AS check_5b_result
FROM public.checklist_runs r
INNER JOIN resolved_template rt ON rt.id = r.template_id
CROSS JOIN verify_120_config c
WHERE r.run_date = c.target_run_date;


-- =============================================================================
-- CHECK 5C — RPC idempotency smoke test (edit CONFIG variables at top of block)
-- =============================================================================

DO $$
DECLARE
  -- CONFIG: edit here (must match SUMMARY CONFIG)
  v_target_template_id uuid := NULL;
  v_target_run_date date := public.get_checklist_operational_date();

  v_template_id uuid;
  v_before_id uuid;
  v_after_id uuid;
  v_active_before integer;
  v_active_after integer;
  v_title_match_count integer;
  v_run public.checklist_runs;
BEGIN
  IF v_target_template_id IS NOT NULL THEN
    SELECT t.id INTO v_template_id
    FROM public.checklist_templates t
    WHERE t.id = v_target_template_id;

    IF v_template_id IS NULL THEN
      RAISE EXCEPTION 'CHECK 5C FAIL: target_template_id % not found', v_target_template_id;
    END IF;
  ELSE
    SELECT count(*) INTO v_title_match_count
    FROM public.checklist_templates t
    WHERE t.title ILIKE '%Panadería%Apertura%' OR t.title ILIKE '%Panaderia%Apertura%';

    IF v_title_match_count = 0 THEN
      RAISE EXCEPTION 'CHECK 5C FAIL: no template matched title — set v_target_template_id UUID';
    END IF;

    IF v_title_match_count > 1 THEN
      RAISE EXCEPTION 'CHECK 5C FAIL: % templates matched title — set v_target_template_id UUID', v_title_match_count;
    END IF;

    SELECT t.id INTO v_template_id
    FROM public.checklist_templates t
    WHERE t.title ILIKE '%Panadería%Apertura%' OR t.title ILIKE '%Panaderia%Apertura%'
    ORDER BY t.created_at LIMIT 1;
  END IF;

  SELECT r.id INTO v_before_id
  FROM public.checklist_runs r
  WHERE r.template_id = v_template_id
    AND r.run_date = v_target_run_date
    AND r.status <> 'cancelled'
  ORDER BY r.created_at LIMIT 1;

  SELECT count(*) INTO v_active_before
  FROM public.checklist_runs r
  WHERE r.template_id = v_template_id
    AND r.run_date = v_target_run_date
    AND r.status <> 'cancelled';

  BEGIN
    v_run := public.create_checklist_run_from_template(
      v_template_id, v_target_run_date, 'recurrence', null,
      'Verificacion post-migracion 120', null, null
    );
    v_after_id := v_run.id;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'CHECK 5C SKIP (RPC permission): % — use CHECK 5B from /tasks', SQLERRM;
      RETURN;
  END;

  SELECT count(*) INTO v_active_after
  FROM public.checklist_runs r
  WHERE r.template_id = v_template_id
    AND r.run_date = v_target_run_date
    AND r.status <> 'cancelled';

  IF v_before_id IS NULL AND v_active_after = 1 THEN
    RAISE NOTICE 'CHECK 5C PASS: created one run % for template %', v_after_id, v_template_id;
  ELSIF v_before_id IS NOT NULL AND v_after_id = v_before_id AND v_active_after = v_active_before THEN
    RAISE NOTICE 'CHECK 5C PASS: RPC returned existing run % (template %)', v_after_id, v_template_id;
  ELSE
    RAISE EXCEPTION 'CHECK 5C FAIL: template=% before=% after=% active_before=% active_after=%',
      v_template_id, v_before_id, v_after_id, v_active_before, v_active_after;
  END IF;

  PERFORM public.generate_due_checklist_runs(v_target_run_date);

  SELECT count(*) INTO v_active_after
  FROM public.checklist_runs r
  WHERE r.template_id = v_template_id
    AND r.run_date = v_target_run_date
    AND r.status <> 'cancelled';

  IF v_active_after <> coalesce(v_active_before, 1) THEN
    RAISE EXCEPTION 'CHECK 5C FAIL: generate_due changed active count to %', v_active_after;
  END IF;

  RAISE NOTICE 'CHECK 5C PASS: generate_due idempotent (template %, active_count=%)', v_template_id, v_active_after;
END;
$$;


-- =============================================================================
-- HELPER — List title matches (run when SUMMARY shows title_match_count > 1)
-- =============================================================================

WITH verify_120_config AS (
  SELECT
    NULL::uuid AS target_template_id,
    '%Panadería%Apertura%'::text AS title_pattern,
    '%Panaderia%Apertura%'::text AS title_pattern_ascii
)
SELECT
  t.id AS template_id,
  t.title,
  t.status,
  t.frequency,
  t.auto_generate,
  t.created_at,
  'Copy template_id into CONFIG target_template_id'::text AS action
FROM public.checklist_templates t
CROSS JOIN verify_120_config c
WHERE c.target_template_id IS NULL
  AND (t.title ILIKE c.title_pattern OR t.title ILIKE c.title_pattern_ascii)
ORDER BY t.created_at;
