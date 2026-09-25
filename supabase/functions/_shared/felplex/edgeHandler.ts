import { assertCashOperator, normalizeProfileRole } from "./auth.ts"
import { certifyInvoice } from "./certifyService.ts"
import { GENERIC_INTERNAL_ERROR } from "./rpcErrors.ts"
import type { FelplexTransport } from "./types.ts"
import type { FelRepository } from "./repository.ts"
import type { ActorProfile } from "./types.ts"

export interface FelplexCertifyHttpDeps {
  env: Pick<typeof Deno.env, "get">
  transport: FelplexTransport
  createRepository: () => FelRepository
  getUserFromToken: (token: string) => Promise<{ id: string; role: string; status: string } | null>
  nowIso?: string
}

export interface FelplexCertifyHttpResult {
  status: number
  body: Record<string, unknown>
}

export async function handleFelplexCertifyInvoiceHttp(
  req: Pick<Request, "method" | "json"> & { headers: Pick<Headers, "get"> },
  deps: FelplexCertifyHttpDeps,
): Promise<FelplexCertifyHttpResult> {
  if (req.method !== "POST") {
    return { status: 405, body: { error: "Metodo no permitido." } }
  }

  const supabaseUrl = deps.env.get("SUPABASE_URL")
  const serviceKey = deps.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) {
    return { status: 500, body: { error: "Funcion no configurada." } }
  }

  const token = req.headers.get("Authorization")?.replace("Bearer ", "")
  if (!token) return { status: 401, body: { error: "No autorizado." } }

  const user = await deps.getUserFromToken(token)
  if (!user) return { status: 401, body: { error: "No autorizado." } }

  const actor: ActorProfile = {
    id: user.id,
    role: normalizeProfileRole(user.role),
    status: user.status,
  }

  if (assertCashOperator(actor) !== null) {
    return { status: 403, body: { error: "No autorizado para certificar." } }
  }

  const body = await req.json().catch(() => null) as { document_id?: string } | null
  const documentId = String(body?.document_id || "").trim()
  if (!documentId) return { status: 400, body: { error: "Debes indicar document_id." } }

  const result = await certifyInvoice(
    { document_id: documentId },
    {
      repository: deps.createRepository(),
      transport: deps.transport,
      env: deps.env,
      nowIso: deps.nowIso ?? new Date().toISOString(),
      actor,
    },
  )

  return { status: result.status, body: result.body as unknown as Record<string, unknown> }
}

export async function handleFelplexCertifyInvoiceHttpSafe(
  req: Pick<Request, "method" | "json"> & { headers: Pick<Headers, "get"> },
  deps: FelplexCertifyHttpDeps,
): Promise<FelplexCertifyHttpResult> {
  try {
    return await handleFelplexCertifyInvoiceHttp(req, deps)
  } catch {
    return { status: 500, body: { error: GENERIC_INTERNAL_ERROR } }
  }
}
