/**
 * felplex-certify-invoice — FELplex Phase 1A.2 (Stage-only, transactional RPCs, HTTP blocked by default).
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.8"
import { corsHeaders, json } from "../_shared/userLifecycle.ts"
import { handleFelplexCertifyInvoiceHttpSafe } from "../_shared/felplex/edgeHandler.ts"
import { createFetchFelplexTransport } from "../_shared/felplex/transport.ts"
import type {
  ClaimCertificationResult,
  FelDocumentRow,
  FinalizeCertificationResult,
  PaymentReconciliation,
} from "../_shared/felplex/types.ts"
import type { FelRepository } from "../_shared/felplex/repository.ts"
import { ClaimError, FinalizeError } from "../_shared/felplex/repository.ts"
import { parseFelRpcErrorCode } from "../_shared/felplex/rpcErrors.ts"

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Funcion no configurada." }, 500)
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const result = await handleFelplexCertifyInvoiceHttpSafe(req, {
    env: Deno.env,
    transport: createFetchFelplexTransport(),
    createRepository: () => createSupabaseFelRepository(admin),
    getUserFromToken: async (token) => {
      const { data, error } = await admin.auth.getUser(token)
      if (error || !data.user) return null
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("id, role, status")
        .eq("id", data.user.id)
        .single()
      if (profileError || !profile) return null
      return profile
    },
  })

  return json(result.body, result.status)
})

function createSupabaseFelRepository(admin: SupabaseClient): FelRepository {
  return {
    async getDocument(documentId) {
      const { data, error } = await admin
        .from("pos_fel_documents")
        .select("*")
        .eq("id", documentId)
        .maybeSingle()
      if (error || !data) return null
      return mapDocument(data)
    },
    async getEmissionConfig() {
      const { data } = await admin.from("fel_emission_config").select("*").eq("id", 1).maybeSingle()
      return data as FelRepository extends { getEmissionConfig(): Promise<infer T> } ? T : never
    },
    async getProviderConfig(environment) {
      const { data } = await admin
        .from("billing_provider_configs")
        .select("*")
        .eq("provider_code", "felplex_gt")
        .eq("environment", environment)
        .eq("is_active", true)
        .eq("is_default", true)
        .maybeSingle()
      return data as FelRepository extends { getProviderConfig(env: "stage"): Promise<infer T> } ? T : never
    },
    async getPaymentReconciliation(orderId) {
      const { data, error } = await admin.rpc("fel_order_payment_reconciliation", {
        p_order_id: orderId,
      } as never)
      if (error || !data) return null
      return data as PaymentReconciliation
    },
    async claimCertificationAttempt(documentId, actorId) {
      const { data, error } = await admin.rpc("fel_claim_pos_fel_certification_attempt", {
        p_document_id: documentId,
        p_actor_id: actorId,
      } as never)

      if (error) {
        throw new ClaimError(parseFelRpcErrorCode(error.message), error.message)
      }

      if (!data || typeof data !== "object") return null
      const row = data as Record<string, unknown>
      return {
        document_id: String(row.document_id),
        attempt_id: String(row.attempt_id),
        attempt_number: Number(row.attempt_number),
        status: "processing" as const,
      } satisfies ClaimCertificationResult
    },
    async finalizeCertificationAttempt(input) {
      const { data, error } = await admin.rpc("fel_finalize_pos_fel_certification_attempt", {
        p_document_id: input.documentId,
        p_attempt_id: input.attemptId,
        p_outcome: input.outcome,
        p_fel_uuid: input.felUuid ?? null,
        p_sat_authorization: input.satAuthorization ?? null,
        p_sat_series: input.satSeries ?? null,
        p_sat_document_number: input.satDocumentNumber ?? null,
        p_certified_at: input.certifiedAt ?? null,
        p_http_status: input.httpStatus ?? null,
        p_error_code: input.errorCode ?? null,
        p_error_message: input.errorMessage ?? null,
        p_safe_response_payload: input.safeResponsePayload ?? null,
        p_request_payload: input.requestPayload ?? null,
      } as never)

      if (error) {
        throw new FinalizeError(parseFelRpcErrorCode(error.message), error.message)
      }

      if (!data || typeof data !== "object") return null
      const row = data as Record<string, unknown>
      return {
        document_id: String(row.document_id),
        attempt_id: String(row.attempt_id),
        status: String(row.status) as FinalizeCertificationResult["status"],
        outcome: String(row.outcome) as FinalizeCertificationResult["outcome"],
      } satisfies FinalizeCertificationResult
    },
  }
}

function mapDocument(row: Record<string, unknown>): FelDocumentRow {
  return {
    id: String(row.id),
    order_id: String(row.order_id),
    external_id: String(row.external_id),
    environment: row.environment as FelDocumentRow["environment"],
    status: row.status as FelDocumentRow["status"],
    receiver_nit: String(row.receiver_nit),
    receiver_name: String(row.receiver_name),
    receiver_address: row.receiver_address ? String(row.receiver_address) : null,
    receiver_email: row.receiver_email ? String(row.receiver_email) : null,
    fiscal_description: String(row.fiscal_description),
    gross_items_total: Number(row.gross_items_total),
    discount_total: Number(row.discount_total),
    tip_total: Number(row.tip_total),
    taxable_gross_total: Number(row.taxable_gross_total),
    taxable_base: Number(row.taxable_base),
    vat_rate: Number(row.vat_rate),
    vat_total: Number(row.vat_total),
    invoice_total: Number(row.invoice_total),
    request_payload: row.request_payload,
    response_payload: row.response_payload,
    fel_uuid: row.fel_uuid ? String(row.fel_uuid) : null,
    sat_authorization: row.sat_authorization ? String(row.sat_authorization) : null,
    sat_series: row.sat_series ? String(row.sat_series) : null,
    sat_document_number: row.sat_document_number ? String(row.sat_document_number) : null,
    certified_at: row.certified_at ? String(row.certified_at) : null,
    retry_count: Number(row.retry_count ?? 0),
    last_error: row.last_error ? String(row.last_error) : null,
  }
}
