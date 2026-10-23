import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

type ToastTone = 'info' | 'ok' | 'error';
type ToastItem = { id: number; tone: ToastTone; message: ReactNode };
type ToastApi = { toast: (message: ReactNode, tone?: ToastTone) => void };

const Ctx = createContext<ToastApi>({ toast: () => {} });
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const toast = useCallback((message: ReactNode, tone: ToastTone = 'info') => {
    const id = nextId++;
    setItems((cur) => [...cur, { id, tone, message }]);
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), 5000);
  }, []);
  const api = useMemo(() => ({ toast }), [toast]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="sp-toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`sp-toast sp-toast-${t.tone}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
