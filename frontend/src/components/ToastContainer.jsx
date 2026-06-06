import "./Toast.css"

export function ToastContainer({ toasts, onDismiss }) {
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          <span>{toast.message}</span>
          <button onClick={() => onDismiss(toast.id)} className="toast-close">&times;</button>
        </div>
      ))}
    </div>
  )
}
