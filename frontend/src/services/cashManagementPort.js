import {
  cashSummary,
  closeCashSession,
  createCashMovement,
  getCashMovements,
  getCashRegisters,
  getCashSessions,
  getOpenCashSession,
  openCashSession
} from "./cashService"

export function createHumanCashPort() {
  return {
    mode: "human",
    async load(selectedRegisterId) {
      const registerResult = await getCashRegisters()
      if (registerResult.error) return { error: registerResult.error, data: null }
      const registers = registerResult.data || []
      const registerId = selectedRegisterId || registers[0]?.id || ""
      const [sessionResult, sessionsResult] = await Promise.all([
        getOpenCashSession(registerId),
        getCashSessions(20)
      ])
      if (sessionResult.error) {
        return { error: sessionResult.error, data: null }
      }
      const session = sessionResult.data || null
      const movementResult = await getCashMovements(session?.id)
      return {
        error: movementResult.error || sessionsResult.error || null,
        data: {
          registers,
          registerId,
          session,
          sessions: sessionsResult.data || [],
          movements: movementResult.data || []
        }
      }
    },
    openCashSession,
    createCashMovement,
    closeCashSession,
    cashSummary
  }
}
