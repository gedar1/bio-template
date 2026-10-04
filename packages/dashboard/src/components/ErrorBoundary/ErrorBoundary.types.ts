export interface ErrorBoundaryProps {
  /** Name of the panel (shown in error fallback) */
  name: string;
  children: React.ReactNode;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}
