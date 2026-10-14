import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const utilsDir = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(utilsDir, "../../../supabase/schema/210_checklist_run_inplace_reassign.sql"), "utf8")
const service = readFileSync(join(utilsDir, "../services/checklistsService.js"), "utf8")

function functionBody(source, signature) {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `missing ${signature}`)
  const next = source.indexOf("\nexport ", start + signature.length)
  return source.slice(start, next === -1 ? undefined : next)
}

test("reassignment updates the same checklist run and does not create another", () => {
  assert.match(sql, /update public\.checklist_runs/)
  assert.match(sql, /where id = p_run_id/)
  assert.doesNotMatch(sql, /insert into public\.checklist_runs/i)
  assert.doesNotMatch(sql, /status\s*=\s*'cancelled'/)

  const resolution = functionBody(service, "export async function executeChecklistAssignmentResolution")
  assert.match(resolution, /reassign_checklist_run_inplace/)
  assert.match(resolution, /existedAlready:\s*true/)
  assert.doesNotMatch(resolution, /cancelChecklistRun/)
  assert.doesNotMatch(resolution, /createChecklistRunFromTemplate/)
  assert.doesNotMatch(resolution, /assignment_source/)
  assert.doesNotMatch(resolution, /from\("checklist_runs"\)/)
})
