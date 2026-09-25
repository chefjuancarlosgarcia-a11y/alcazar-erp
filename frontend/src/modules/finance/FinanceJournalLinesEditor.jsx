import { applyAccountQueryChange } from "../../utils/financeJournalAccountMenu"
import { filterCostCentersForBranch } from "../../utils/financeJournalValidation"
import FinanceJournalAccountInput from "./FinanceJournalAccountInput"

export default function FinanceJournalLinesEditor({
  lines,
  isEditable,
  branches,
  costCenters,
  postableAccounts,
  accountsById,
  accountQueries,
  onAccountQueriesChange,
  onUpdateLine,
  onAddLine,
  onDuplicateLine,
  onRemoveLine,
  onSelectAccount
}) {
  return (
    <>
      <div className="finance-journal-lines-wrap">
        <table className="finance-table finance-journal-lines">
          <thead>
            <tr>
              <th scope="col">Cuenta</th>
              <th scope="col">Sucursal</th>
              <th scope="col">Centro costo</th>
              <th scope="col">Descripción</th>
              <th scope="col" className="finance-journal-num">Debe</th>
              <th scope="col" className="finance-journal-num">Haber</th>
              {isEditable ? <th scope="col"><span className="sr-only">Acciones</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const account = accountsById.get(line.account_id)
              const branchRule = account?.branch_dimension_rule || "optional"
              const ccRule = account?.cost_center_dimension_rule || "optional"
              const ccOptions = filterCostCentersForBranch(costCenters, line.branch_id)
              const query = accountQueries[index] ?? line.account_label ?? ""
              const debitId = `journal-line-${index}-debit`
              const creditId = `journal-line-${index}-credit`

              return (
                <tr key={line.key || index}>
                  <td className="finance-journal-account-cell">
                    <label className="sr-only" htmlFor={`journal-line-${index}-account`}>Cuenta línea {index + 1}</label>
                    <FinanceJournalAccountInput
                      index={index}
                      line={line}
                      query={query}
                      isEditable={isEditable}
                      postableAccounts={postableAccounts}
                      onQueryChange={(nextQuery) => {
                        const { query: keptQuery, linePatch } = applyAccountQueryChange(line, nextQuery)
                        onAccountQueriesChange(index, keptQuery)
                        if (linePatch) onUpdateLine(index, linePatch)
                      }}
                      onSelectAccount={(account) => onSelectAccount(index, account)}
                    />
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`journal-line-${index}-branch`}>Sucursal línea {index + 1}</label>
                    <select
                      id={`journal-line-${index}-branch`}
                      value={line.branch_id}
                      disabled={!isEditable || branchRule === "prohibited"}
                      onChange={(e) => onUpdateLine(index, { branch_id: e.target.value, cost_center_id: "" })}
                    >
                      <option value="">{branchRule === "required" ? "Seleccione…" : "—"}</option>
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>{branch.code}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`journal-line-${index}-cc`}>Centro de costo línea {index + 1}</label>
                    <select
                      id={`journal-line-${index}-cc`}
                      value={line.cost_center_id}
                      disabled={!isEditable || ccRule === "prohibited"}
                      onChange={(e) => onUpdateLine(index, { cost_center_id: e.target.value })}
                    >
                      <option value="">{ccRule === "required" ? "Seleccione…" : "—"}</option>
                      {ccOptions.map((cc) => (
                        <option key={cc.id} value={cc.id}>{cc.code} — {cc.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`journal-line-${index}-desc`}>Descripción línea {index + 1}</label>
                    <input
                      id={`journal-line-${index}-desc`}
                      type="text"
                      value={line.description}
                      disabled={!isEditable}
                      onChange={(e) => onUpdateLine(index, { description: e.target.value })}
                    />
                  </td>
                  <td className="finance-journal-num">
                    <label className="sr-only" htmlFor={debitId}>Débito línea {index + 1}</label>
                    <input
                      id={debitId}
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*[.,]?[0-9]{0,2}"
                      value={line.debit}
                      disabled={!isEditable}
                      onChange={(e) => onUpdateLine(index, { debit: e.target.value, credit: "" })}
                    />
                  </td>
                  <td className="finance-journal-num">
                    <label className="sr-only" htmlFor={creditId}>Crédito línea {index + 1}</label>
                    <input
                      id={creditId}
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*[.,]?[0-9]{0,2}"
                      value={line.credit}
                      disabled={!isEditable}
                      onChange={(e) => onUpdateLine(index, { credit: e.target.value, debit: "" })}
                    />
                  </td>
                  {isEditable ? (
                    <td className="finance-journal-line-actions">
                      <button type="button" className="tasks-link" onClick={() => onDuplicateLine(index)}>Dup.</button>
                      <button type="button" className="tasks-link" onClick={() => onRemoveLine(index)} disabled={lines.length <= 2}>Quitar</button>
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {isEditable ? (
        <div className="finance-actions">
          <button type="button" className="tasks-secondary" onClick={onAddLine}>Agregar línea</button>
        </div>
      ) : null}
    </>
  )
}
