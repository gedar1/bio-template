export type ToastType = "success" | "error" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

export interface ToastContextValue {
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  showInfo: (message: string) => void;
}

export interface ToastProviderProps {
  children: React.ReactNode;
}

export interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}
