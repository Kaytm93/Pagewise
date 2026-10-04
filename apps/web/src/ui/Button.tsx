import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const base =
  'mo-press inline-flex min-h-11 select-none items-center justify-center gap-2 font-medium disabled:cursor-not-allowed disabled:opacity-50';

// Primäre Aktionen sind Pills in Graphite, alles andere hat die 6-px-Rundung der Bedienelemente.
const variants: Record<Variant, string> = {
  primary: 'lg-btn-primary rounded-pill bg-primary px-5 text-on-primary hover:opacity-90',
  secondary: 'rounded-control border border-control-edge bg-canvas px-4 text-ink hover:bg-paper',
  ghost: 'rounded-control px-3 text-ink-secondary hover:bg-paper hover:text-ink',
  danger: 'rounded-control border border-control-edge bg-canvas px-4 text-danger hover:bg-paper',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Zeigt einen Spinner und sperrt den Button, solange etwas läuft. */
  busy?: boolean;
}

export function Button({
  variant = 'secondary',
  busy = false,
  className = '',
  disabled,
  type = 'button',
  children,
  ...rest
}: Props) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`${base} ${variants[variant]} ${className}`}
      {...rest}
    >
      {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
      {children}
    </button>
  );
}
