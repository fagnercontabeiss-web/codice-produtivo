import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    this.setState({ info })
  }
  render() {
    if (this.state.error) {
      const stack = this.state.info?.componentStack || ''
      return React.createElement('div', {
        style: { padding: '32px', background: '#0f1117', minHeight: '100vh', fontFamily: 'monospace' }
      },
        React.createElement('h2', { style: { color: '#ef4444', fontSize: '18px', marginBottom: '12px' } }, '❌ Erro — ' + String(this.state.error?.name)),
        React.createElement('pre', {
          style: { background: '#1a1d23', color: '#10b981', padding: '16px', borderRadius: '8px', fontSize: '11px', whiteSpace: 'pre-wrap', overflowX: 'auto', marginBottom: '12px' }
        }, String(this.state.error?.message) + '\n\n' + String(this.state.error?.stack || '')),
        React.createElement('pre', {
          style: { background: '#1a1d23', color: '#f59e0b', padding: '16px', borderRadius: '8px', fontSize: '11px', whiteSpace: 'pre-wrap', overflowX: 'auto' }
        }, 'Componente:\n' + stack.slice(0, 800))
      )
    }
    return this.props.children
  }
}

// SEM StrictMode para evitar double-invoke
ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement(ErrorBoundary, null, React.createElement(App))
)
