import { Component } from "react"

export default class ChecklistWizardStepBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error("Checklist wizard step failed:", error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="checklist-step-card">
          <p className="tasks-warning" role="alert">
            No se pudo abrir este paso del asistente. {this.state.error.message || "Error inesperado."}
          </p>
          <button type="button" className="tasks-secondary" onClick={() => this.setState({ error: null })}>
            Reintentar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
