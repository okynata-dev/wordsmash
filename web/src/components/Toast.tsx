import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type ToastKind = "info" | "success" | "error";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  push: (kind: ToastKind, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, kind, message }]);
      window.setTimeout(() => remove(id), 6000);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-4 right-4 z-50 flex w-[min(92vw,360px)] flex-col gap-2"
      >
        {toasts.map((t) => (
          <button
            key={t.id}
            aria-label={`Dismiss ${t.kind} notification`}
            onClick={() => remove(t.id)}
            className={[
              "rounded-lg border px-4 py-3 text-left text-sm shadow-sm transition",
              "bg-surface text-fg",
              t.kind === "error" ? "border-negative/40" : "",
              t.kind === "success" ? "border-positive/40" : "",
            ].join(" ")}
          >
            <span
              className={
                t.kind === "error"
                  ? "text-negative"
                  : t.kind === "success"
                    ? "text-positive"
                    : "text-fg"
              }
            >
              {t.message}
            </span>
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
