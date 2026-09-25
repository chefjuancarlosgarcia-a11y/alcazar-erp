/**
 * Shared guard: refuse remote database hosts in finance lab runners.
 */
import { spawnSync } from "node:child_process"

const REMOTE_HOST_PATTERN = /supabase\.co|\.amazonaws\.com|\.azure\.|production|(?<![a-z])prod(?![a-z])/i
const LOCAL_HOST_PATTERN = /localhost|127\.0\.0\.1|host\.docker\.internal/i

export function assertLocalLabEnvironment() {
  for (const key of ["DATABASE_URL", "ALCAZAR_STAGE_DATABASE_URL", "SUPABASE_DB_URL", "PGHOST"]) {
    const value = process.env[key]
    if (!value) continue
    if (REMOTE_HOST_PATTERN.test(value)) {
      throw new Error(`Refusing lab run: ${key} appears to target a remote or production host`)
    }
    if (key === "PGHOST" && !LOCAL_HOST_PATTERN.test(value) && value !== "postgres") {
      throw new Error(`Refusing lab run: PGHOST must be local (${value})`)
    }
    if (key !== "PGHOST" && !LOCAL_HOST_PATTERN.test(value)) {
      throw new Error(`Refusing lab run: ${key} must target localhost or 127.0.0.1`)
    }
  }
}

export function assertDockerAvailable() {
  const docker = spawnSync("docker", ["version"], { encoding: "utf8" })
  if (docker.status !== 0) {
    throw new Error("Docker is required for finance lab runners")
  }
}

export const LOCAL_LAB_PROJECT_REF = "local-lab-finance-package"
