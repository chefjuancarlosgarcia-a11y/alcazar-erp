export function Field({ label, className = "", children, htmlFor, errorId, error }) {
  return (
    <label className={`finance-field ${className}`.trim()} htmlFor={htmlFor}>
      <span>{label}</span>
      {children}
      {error ? (
        <span id={errorId} className="finance-field-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  )
}
