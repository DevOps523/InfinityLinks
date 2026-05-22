import { X } from 'lucide-react';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

type Toast = {
  id: number;
  message: string;
  tone: 'success' | 'error';
};

type ToastContextValue = {
  showToast: (message: string, tone?: Toast['tone']) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const value = useMemo<ToastContextValue>(
    () => ({
      showToast(message, tone = 'success') {
        const id = Date.now() + Math.random();
        setToasts((current) => [...current, { id, message, tone }]);
      }
    }),
    []
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => (
          <div className={`toast toast--${toast.tone}`} key={toast.id}>
            <span>{toast.message}</span>
            <button
              className="toast__dismiss"
              type="button"
              aria-label="Dismiss message"
              onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
            >
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }

  return context;
}
