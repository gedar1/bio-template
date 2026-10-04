import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from "react";
import type {
  Toast,
  ToastType,
  ToastContextValue,
  ToastProviderProps,
  ToastItemProps,
} from "./Toast.types";

const MAX_TOASTS = 3;
const AUTO_DISMISS_MS = 4000;

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback(
    (type: ToastType, message: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const toast: Toast = { id, type, message };

      setToasts((prev) => {
        const next = [...prev, toast];
        // Remove oldest if exceeding max
        if (next.length > MAX_TOASTS) {
          const removed = next.shift();
          if (removed) {
            const timer = timersRef.current.get(removed.id);
            if (timer) {
              clearTimeout(timer);
              timersRef.current.delete(removed.id);
            }
          }
        }
        return next;
      });

      // Auto-dismiss after 4 seconds
      const timer = setTimeout(() => {
        dismiss(id);
      }, AUTO_DISMISS_MS);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  const showSuccess = useCallback(
    (message: string) => addToast("success", message),
    [addToast],
  );
  const showError = useCallback(
    (message: string) => addToast("error", message),
    [addToast],
  );
  const showInfo = useCallback(
    (message: string) => addToast("info", message),
    [addToast],
  );

  return (
    <ToastContext.Provider value={{ showSuccess, showError, showInfo }}>
      {children}
      {/* Toast container — bottom-right */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

const ToastItem: React.FC<ToastItemProps> = ({ toast, onDismiss }) => {
  const colorMap: Record<ToastType, string> = {
    success: "bg-green-600 border-green-500",
    error: "bg-red-600 border-red-500",
    info: "bg-blue-600 border-blue-500",
  };

  const iconMap: Record<ToastType, string> = {
    success: "✓",
    error: "✕",
    info: "ℹ",
  };

  return (
    <div
      className={`pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-lg border text-white text-sm shadow-lg animate-slide-in-right ${colorMap[toast.type]}`}
      role="alert"
    >
      <span className="font-bold text-base">{iconMap[toast.type]}</span>
      <span className="flex-1">{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-white/70 hover:text-white text-xs ml-2"
        aria-label="Cerrar notificación"
      >
        ✕
      </button>
    </div>
  );
};
