import React from "react";
import type {
  ErrorBoundaryProps,
  ErrorBoundaryState,
} from "./ErrorBoundary.types";

/**
 * Error Boundary that catches render errors in child components
 * and displays a fallback UI without crashing the entire app.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[ErrorBoundary] ${this.props.name}:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-red-900/20 border border-red-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-red-400 text-lg">⚠️</span>
            <span className="text-red-300 text-sm font-medium">
              Error en {this.props.name}
            </span>
          </div>
          <p className="text-red-400/70 text-xs mb-3">
            {this.state.error?.message ?? "Error desconocido"}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="text-xs bg-red-700 text-white px-3 py-1 rounded hover:bg-red-600"
          >
            Reintentar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
