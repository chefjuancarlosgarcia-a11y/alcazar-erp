export const GENERAL_JOURNAL_MIGRATION_HINT =
  "Aplica la migración 208_finance_general_journal.sql en Supabase."

export const GENERAL_JOURNAL_RPC_UNAVAILABLE =
  "Supabase no está configurado para el Libro Diario."

export const GENERAL_JOURNAL_PAGE_SIZES = [24, 50, 100, 200]

export const GENERAL_JOURNAL_DEFAULT_PAGE_SIZE = 50

export const GENERAL_JOURNAL_MAX_PAGE_SIZE = 500

export const GENERAL_JOURNAL_MAX_EXPORT_ROWS = 10000

export const GENERAL_JOURNAL_COMING_SOON_REPORTS = [
  { key: "libro-mayor", label: "Libro Mayor" },
  { key: "balanza", label: "Balanza de Comprobación" },
  { key: "estado-resultados", label: "Estado de Resultados" },
  { key: "balance-general", label: "Balance General" }
]

export const GENERAL_JOURNAL_BRANCH_SCOPE_NOTE =
  "El alcance por sucursal depende de accounting_journal_branch_scope(); hoy retorna NULL (sin restricción adicional)."
