'use client';

import { createContext, useCallback, useContext, useState } from 'react';

type Toast = { id: number; message: string; kind: 'info' | 'success' | 'error' };
const ToastCtx = createContext<{ push: (m: string, k?: Toast['kind']) => void } | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = (counter += 1);
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-md px-4 py-2 text-sm text-white shadow-lg ${t.kind === 'error' ? 'bg-red-600' : t.kind === 'success' ? 'bg-green-600' : 'bg-zinc-800'}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToastCtx() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
