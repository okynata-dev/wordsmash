import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

type Variant = "primary" | "ghost" | "outline" | "danger";

export function Button({
  variant = "primary",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent/30";
  const variants: Record<Variant, string> = {
    primary: "bg-accent text-accent-fg hover:opacity-90",
    ghost: "text-fg hover:bg-surface-2",
    outline: "border border-border bg-surface text-fg hover:bg-surface-2",
    danger: "border border-negative/40 text-negative hover:bg-negative/10",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Card({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`rounded-xl border border-border bg-surface ${className}`} style={style}>
      {children}
    </div>
  );
}

/** Brand loader: the orbit mark in motion — a faint ring with the word-satellite circling it. */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span className={`relative inline-block h-4 w-4 animate-spin ${className}`} aria-hidden>
      <span className="absolute inset-[2px] rounded-full border border-current opacity-40" />
      <span className="absolute left-1/2 top-0 h-[5px] w-[5px] -translate-x-1/2 rounded-full bg-current" />
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-md ${className}`} aria-hidden />;
}

/** Standard error+retry block for failed queries. Never leaves a blank/perpetual loader. */
export function ErrorState({
  message = "Couldn’t load this right now.",
  onRetry,
  className = "",
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Card className={`flex flex-col items-center gap-3 p-6 text-center ${className}`} >
      <p role="alert" className="text-sm text-muted">
        {message}
      </p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </Card>
  );
}

export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "positive" | "negative" | "warning" }) {
  const tones = {
    muted: "bg-surface-2 text-muted",
    positive: "bg-positive/10 text-positive",
    negative: "bg-negative/10 text-negative",
    warning: "bg-warning/10 text-warning",
  } as const;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
