-- Read-only diagnostics for 187 POS table service lifecycle (pure SELECT).
-- Run manually in SQL Editor as postgres. Does NOT require migration 187 applied.
-- Shared dine-in scope predicate (must match 187 migration gate + index):
--   coalesce(nullif(btrim(sales_channel), ''), 'dine_in') = 'dine_in'
--   AND table_id IS NOT NULL AND btrim(table_id) <> ''
--   AND status IN ('open','sent','awaiting_bill','sent_to_cashier','partially_paid')

WITH active_statuses AS (
  SELECT unnest(
    ARRAY['open', 'sent', 'awaiting_bill', 'sent_to_cashier', 'partially_paid']::text[]
  ) AS status
),
order_metrics AS (
  SELECT
    o.id AS order_id,
    o.table_id,
    coalesce(nullif(btrim(o.sales_channel), ''), 'dine_in') AS sales_channel,
    o.status AS order_status,
    o.owner_profile_id,
    o.total,
    o.created_at,
    count(i.id) FILTER (WHERE i.status <> 'cancelled')::bigint AS active_item_count,
    count(i.id) FILTER (WHERE i.status = 'cancelled')::bigint AS cancelled_item_count,
    (
      SELECT count(*)::bigint
      FROM public.production_tickets t
      WHERE t.order_id = o.id::text
    ) AS kds_ticket_count,
    (
      SELECT count(*)::bigint
      FROM public.pos_order_payments p
      WHERE p.order_id = o.id
        AND p.status = 'paid'
    ) AS payment_count,
    exists (
      SELECT 1
      FROM public.pos_order_items ii
      WHERE ii.order_id = o.id
    ) AS has_any_items,
    exists (
      SELECT 1
      FROM public.pos_order_items ii
      WHERE ii.order_id = o.id
        AND ii.status NOT IN ('draft', 'cancelled')
    )
    OR exists (
      SELECT 1
      FROM public.production_tickets t
      WHERE t.order_id = o.id::text
    ) AS has_kds_history
  FROM public.pos_orders o
  LEFT JOIN public.pos_order_items i ON i.order_id = o.id
  WHERE o.status IN (SELECT status FROM active_statuses)
  GROUP BY o.id, o.table_id, o.sales_channel, o.status, o.owner_profile_id, o.total, o.created_at
),
enriched AS (
  SELECT
    om.*,
    (
      coalesce(nullif(btrim(om.sales_channel), ''), 'dine_in') = 'dine_in'
      AND om.table_id IS NOT NULL
      AND btrim(om.table_id) <> ''
      AND om.order_status IN (SELECT status FROM active_statuses)
    ) AS in_dine_in_table_service_scope,
    CASE
      WHEN om.order_status IN ('paid', 'cancelled') THEN 'terminal'
      WHEN om.active_item_count > 0 THEN 'active_with_items'
      WHEN om.order_status = 'open'
        AND om.active_item_count = 0
        AND om.payment_count = 0
        AND NOT om.has_any_items
        THEN 'pending_release_empty'
      WHEN om.order_status = 'open'
        AND om.active_item_count = 0
        AND om.payment_count = 0
        AND om.has_any_items
        THEN 'pending_release_all_cancelled'
      ELSE 'active_with_items'
    END AS operational_state,
    CASE
      WHEN om.payment_count > 0 OR om.order_status = 'partially_paid' THEN 'payments_present'
      WHEN om.order_status IN ('awaiting_bill', 'sent_to_cashier') THEN 'billing_state'
      WHEN om.has_kds_history OR om.kds_ticket_count > 0 THEN 'kds_history'
      ELSE 'no_history'
    END AS risk_level
  FROM order_metrics om
),
dine_in_active AS (
  SELECT e.*
  FROM enriched e
  WHERE e.in_dine_in_table_service_scope
),
non_dine_in_active AS (
  SELECT e.*
  FROM enriched e
  WHERE NOT e.in_dine_in_table_service_scope
),
duplicate_tables AS (
  SELECT
    d.table_id,
    count(*)::bigint AS active_order_count,
    array_agg(d.order_id ORDER BY d.created_at) AS order_ids
  FROM dine_in_active d
  GROUP BY d.table_id
  HAVING count(*) > 1
),
duplicate_gate AS (
  SELECT coalesce(count(*)::bigint, 0) AS duplicate_table_count
  FROM duplicate_tables
),
evidence_metrics AS (
  SELECT
    o.id AS order_id,
    o.table_id,
    coalesce(nullif(btrim(o.sales_channel), ''), 'dine_in') AS sales_channel,
    o.status AS order_status,
    o.owner_profile_id,
    o.total,
    o.created_at,
    count(i.id) FILTER (WHERE i.status <> 'cancelled')::bigint AS active_item_count,
    count(i.id) FILTER (WHERE i.status = 'cancelled')::bigint AS cancelled_item_count,
    (
      SELECT count(*)::bigint
      FROM public.production_tickets t
      WHERE t.order_id = o.id::text
    ) AS kds_ticket_count,
    (
      SELECT count(*)::bigint
      FROM public.pos_order_payments p
      WHERE p.order_id = o.id
        AND p.status = 'paid'
    ) AS payment_count,
    exists (
      SELECT 1
      FROM public.pos_order_items ii
      WHERE ii.order_id = o.id
    ) AS has_any_items,
    exists (
      SELECT 1
      FROM public.pos_order_items ii
      WHERE ii.order_id = o.id
        AND ii.status NOT IN ('draft', 'cancelled')
    )
    OR exists (
      SELECT 1
      FROM public.production_tickets t
      WHERE t.order_id = o.id::text
    ) AS has_kds_history
  FROM public.pos_orders o
  LEFT JOIN public.pos_order_items i ON i.order_id = o.id
  WHERE o.id = '4e6ba009-84ae-421e-9c6b-3217b3863dca'::uuid
  GROUP BY o.id, o.table_id, o.sales_channel, o.status, o.owner_profile_id, o.total, o.created_at
),
evidence_enriched AS (
  SELECT
    em.*,
    CASE
      WHEN em.order_status IN ('paid', 'cancelled') THEN 'terminal'
      WHEN em.active_item_count > 0 THEN 'active_with_items'
      WHEN em.order_status = 'open'
        AND em.active_item_count = 0
        AND em.payment_count = 0
        AND NOT em.has_any_items
        THEN 'pending_release_empty'
      WHEN em.order_status = 'open'
        AND em.active_item_count = 0
        AND em.payment_count = 0
        AND em.has_any_items
        THEN 'pending_release_all_cancelled'
      ELSE 'active_with_items'
    END AS operational_state,
    CASE
      WHEN em.payment_count > 0 OR em.order_status = 'partially_paid' THEN 'payments_present'
      WHEN em.order_status IN ('awaiting_bill', 'sent_to_cashier') THEN 'billing_state'
      WHEN em.has_kds_history OR em.kds_ticket_count > 0 THEN 'kds_history'
      ELSE 'no_history'
    END AS risk_level
  FROM evidence_metrics em
),
report AS (
  SELECT
    'summary'::text AS section,
    'global_total_active_status_orders'::text AS gate_code,
    NULL::text AS classification,
    NULL::text AS operational_state,
    NULL::text AS risk_level,
    false AS is_blocker,
    NULL::text AS table_id,
    NULL::uuid AS order_id,
    NULL::text AS order_status,
    NULL::uuid AS owner_profile_id,
    NULL::numeric AS total,
    NULL::bigint AS active_item_count,
    NULL::bigint AS cancelled_item_count,
    NULL::bigint AS kds_ticket_count,
    NULL::bigint AS payment_count,
    NULL::timestamptz AS created_at,
    count(*)::text || ' all channels; not used for Q3 or table-service gate' AS detail
  FROM enriched

  UNION ALL

  SELECT
    'summary', 'global_non_dine_in_active_orders', NULL, NULL, NULL, false,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    count(*)::text || ' delivery/takeout/online or out-of-scope table_id'
  FROM non_dine_in_active

  UNION ALL

  SELECT
    'summary', 'baseline_open_count', NULL, NULL, NULL, false,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    count(*)::text
  FROM public.pos_orders
  WHERE status = 'open'

  UNION ALL

  SELECT
    'summary', 'dine_in_active_scope_orders', NULL, NULL, NULL, false,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    count(*)::text || ' physical table service scope (Q3/index predicate)'
  FROM dine_in_active

  UNION ALL

  SELECT
    'summary', 'dine_in_active_with_items_total', 'active_with_items', 'active_with_items', NULL, false,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    count(*)::text
  FROM dine_in_active
  WHERE operational_state = 'active_with_items'

  UNION ALL

  SELECT
    'summary', 'pending_release_empty_no_history', 'pending_release_empty', 'pending_release_empty', 'no_history', false,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    count(*)::text
  FROM dine_in_active
  WHERE order_status = 'open'
    AND operational_state = 'pending_release_empty'
    AND risk_level = 'no_history'

  UNION ALL

  SELECT
    'summary', 'pending_release_cancelled_no_kds', 'pending_release_all_cancelled', 'pending_release_all_cancelled', 'no_history', false,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    count(*)::text
  FROM dine_in_active
  WHERE order_status = 'open'
    AND operational_state = 'pending_release_all_cancelled'
    AND risk_level = 'no_history'

  UNION ALL

  SELECT
    'summary', 'pending_release_with_kds_history', NULL, NULL, 'kds_history', false,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    count(*)::text
  FROM dine_in_active
  WHERE order_status = 'open'
    AND operational_state IN ('pending_release_empty', 'pending_release_all_cancelled')
    AND risk_level = 'kds_history'

  UNION ALL

  SELECT
    'summary', 'pending_release_total', NULL, NULL, NULL, false,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    count(*)::text || ' dine_in open orders pending manual release'
  FROM dine_in_active
  WHERE order_status = 'open'
    AND operational_state IN ('pending_release_empty', 'pending_release_all_cancelled')

  UNION ALL

  SELECT
    'summary', 'active_billing_total', NULL, NULL, 'billing_state', false,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    count(*)::text || ' dine_in only; excludes delivery/takeout billing rows'
  FROM dine_in_active
  WHERE risk_level = 'billing_state'

  UNION ALL

  SELECT
    'summary', 'active_with_payments_total', NULL, NULL, 'payments_present', false,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    count(*)::text || ' dine_in only'
  FROM dine_in_active
  WHERE risk_level = 'payments_present'

  UNION ALL

  SELECT
    'summary', 'duplicate_table_ids_dine_in', 'duplicate_active_service', NULL, NULL, false,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    (SELECT duplicate_table_count::text FROM duplicate_gate)
    || ' dine_in table_id(s) with >1 active service'

  UNION ALL

  SELECT
    'summary', 'active_service_duplicates', 'duplicate_active_service', NULL, NULL,
    (SELECT duplicate_table_count > 0 FROM duplicate_gate),
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    CASE
      WHEN (SELECT duplicate_table_count FROM duplicate_gate) > 0
        THEN 'Q3 FAIL: resolve duplicate dine_in active orders per table_id before 187 index'
      ELSE 'Q3 PASS: no duplicate dine_in active services per table_id'
    END

  UNION ALL

  SELECT
    'summary', 'evidence_order_present', NULL, NULL, NULL, false,
    NULL,
    '4e6ba009-84ae-421e-9c6b-3217b3863dca'::uuid,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    CASE
      WHEN exists (
        SELECT 1 FROM public.pos_orders
        WHERE id = '4e6ba009-84ae-421e-9c6b-3217b3863dca'::uuid
      ) THEN 'present'
      ELSE 'missing'
    END

  UNION ALL

  SELECT
    'active_orders'::text,
    NULL::text,
    d.operational_state,
    d.operational_state,
    d.risk_level,
    false,
    d.table_id,
    d.order_id,
    d.order_status,
    d.owner_profile_id,
    d.total,
    d.active_item_count,
    d.cancelled_item_count,
    d.kds_ticket_count,
    d.payment_count,
    d.created_at,
    'dine_in physical table service'
  FROM dine_in_active d
  WHERE d.operational_state = 'active_with_items'

  UNION ALL

  SELECT
    'pending_release',
    NULL,
    d.operational_state,
    d.operational_state,
    d.risk_level,
    false,
    d.table_id,
    d.order_id,
    d.order_status,
    d.owner_profile_id,
    d.total,
    d.active_item_count,
    d.cancelled_item_count,
    d.kds_ticket_count,
    d.payment_count,
    d.created_at,
    CASE
      WHEN d.risk_level = 'kds_history'
        THEN 'supervisor+ release; dine_in physical table'
      WHEN d.operational_state = 'pending_release_empty'
        THEN 'manual 187 release; empty open dine_in table'
      ELSE 'manual 187 release; all items cancelled; dine_in table'
    END
  FROM dine_in_active d
  WHERE d.order_status = 'open'
    AND d.operational_state IN ('pending_release_empty', 'pending_release_all_cancelled')

  UNION ALL

  SELECT
    'active_service_duplicates',
    'duplicate_active_service',
    'duplicate_active_service',
    'duplicate_active_service',
    d.risk_level,
    true,
    dt.table_id,
    unnest_order_id,
    d.order_status,
    d.owner_profile_id,
    d.total,
    d.active_item_count,
    d.cancelled_item_count,
    d.kds_ticket_count,
    d.payment_count,
    d.created_at,
    dt.active_order_count::text || ' dine_in active orders on physical table_id'
  FROM duplicate_tables dt
  CROSS JOIN LATERAL unnest(dt.order_ids) AS unnest_order_id
  JOIN dine_in_active d ON d.order_id = unnest_order_id

  UNION ALL

  SELECT
    'kds_history',
    NULL,
    d.operational_state,
    d.operational_state,
    d.risk_level,
    false,
    d.table_id,
    d.order_id,
    d.order_status,
    d.owner_profile_id,
    d.total,
    d.active_item_count,
    d.cancelled_item_count,
    d.kds_ticket_count,
    d.payment_count,
    d.created_at,
    'dine_in table-service risk dimension; not operational_state'
  FROM dine_in_active d
  WHERE d.risk_level = 'kds_history'

  UNION ALL

  SELECT
    'billing',
    NULL,
    d.operational_state,
    d.operational_state,
    d.risk_level,
    false,
    d.table_id,
    d.order_id,
    d.order_status,
    d.owner_profile_id,
    d.total,
    d.active_item_count,
    d.cancelled_item_count,
    d.kds_ticket_count,
    d.payment_count,
    d.created_at,
    'dine_in billing; do not auto-release; supervisor billing path'
  FROM dine_in_active d
  WHERE d.risk_level = 'billing_state'

  UNION ALL

  SELECT
    'payments',
    NULL,
    d.operational_state,
    d.operational_state,
    d.risk_level,
    false,
    d.table_id,
    d.order_id,
    d.order_status,
    d.owner_profile_id,
    d.total,
    d.active_item_count,
    d.cancelled_item_count,
    d.kds_ticket_count,
    d.payment_count,
    d.created_at,
    'dine_in only; payment_count; blocked by 187 release'
  FROM dine_in_active d
  WHERE d.risk_level = 'payments_present'

  UNION ALL

  SELECT
    'non_dine_in_channels',
    NULL,
    n.operational_state,
    n.operational_state,
    n.risk_level,
    false,
    n.table_id,
    n.order_id,
    n.order_status,
    n.owner_profile_id,
    n.total,
    n.active_item_count,
    n.cancelled_item_count,
    n.kds_ticket_count,
    n.payment_count,
    n.created_at,
    'excluded from table-service gate/index; sales_channel=' || n.sales_channel
  FROM non_dine_in_active n

  UNION ALL

  SELECT
    'evidence_4e6ba009',
    NULL,
    ee.operational_state,
    ee.operational_state,
    ee.risk_level,
    false,
    ee.table_id,
    ee.order_id,
    ee.order_status,
    ee.owner_profile_id,
    ee.total,
    ee.active_item_count,
    ee.cancelled_item_count,
    ee.kds_ticket_count,
    ee.payment_count,
    ee.created_at,
    CASE
      WHEN ee.order_id IS NULL THEN 'evidence order not found'
      WHEN ee.operational_state = 'active_with_items'
        THEN 'active service with draft/items; NOT pending release; preserve Maria draft'
      WHEN ee.operational_state IN ('pending_release_empty', 'pending_release_all_cancelled')
        THEN 'manual L3 release candidate; do not auto-fix in migration 187'
      ELSE 'inspect before 187; preserve order and Maria draft'
    END
  FROM evidence_enriched ee
)
SELECT
  section,
  gate_code,
  classification,
  operational_state,
  risk_level,
  is_blocker,
  table_id,
  order_id,
  order_status,
  owner_profile_id,
  total,
  active_item_count,
  cancelled_item_count,
  kds_ticket_count,
  payment_count,
  created_at,
  detail
FROM report
ORDER BY
  section,
  gate_code NULLS LAST,
  operational_state NULLS LAST,
  risk_level NULLS LAST,
  table_id NULLS LAST,
  created_at NULLS LAST,
  order_id NULLS LAST;
