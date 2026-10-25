'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type ToastVariant = 'success' | 'error' | 'info';
type ToastAction = { label: string; onClick: () => void };
type ToastItem = { id: number; message: string; variant: ToastVariant; leaving: boolean; actions?: ToastAction[] };
type ToastFn = (message: string, variant?: ToastVariant, actions?: ToastAction | ToastAction[]) => void;

const ToastContext = createContext<ToastFn | null>(null);

const AUTO_DISMISS_MS = 4200;
const EXIT_ANIMATION_MS = 220;

const ICONS: Record<ToastVariant, string> = {
  success: '✓',
  error: '!',
  info: 'i',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.map(t => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, EXIT_ANIMATION_MS);
  }, []);

  const toast: ToastFn = useCallback(
    (message, variant = 'info', actions) => {
      const id = nextId.current++;
      const list = actions ? (Array.isArray(actions) ? actions : [actions]) : undefined;
      setToasts(prev => [...prev, { id, message, variant, leaving: false, actions: list }]);
      window.setTimeout(() => remove(id), AUTO_DISMISS_MS);
    },
    [remove]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.variant}${t.leaving ? ' toast-leaving' : ''}`} onClick={() => remove(t.id)}>
            <span className="toast-icon" aria-hidden="true">{ICONS[t.variant]}</span>
            <span className="toast-msg">{t.message}</span>
            {t.actions?.map(a => (
              <button
                key={a.label}
                type="button"
                className="toast-action"
                onClick={e => {
                  e.stopPropagation();
                  a.onClick();
                  remove(t.id);
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
