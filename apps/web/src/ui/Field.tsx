import { Eye, EyeOff } from 'lucide-react';
import { type InputHTMLAttributes, type ReactNode, useId, useState } from 'react';
import { messages as m } from '../i18n';
import { FieldError } from './FieldError';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
  /** Markiert ein freiwilliges Feld mit „optional“ hinter dem Namen. */
  optional?: boolean;
  /** Bedienelement am rechten Rand des Feldes (z. B. Passcode anzeigen). */
  trailing?: ReactNode;
}

const inputClass =
  'min-h-11 w-full rounded-control border border-control-edge bg-canvas px-3 text-base text-ink disabled:opacity-60';

export function TextField({
  label,
  hint,
  error,
  optional,
  trailing,
  className = '',
  ...input
}: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {optional && <span className="ml-2 font-normal text-ink-muted">{m.common.optional}</span>}
      </label>
      <div className="relative mt-1.5">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={`${inputClass} ${trailing ? 'pr-12' : ''}`}
          {...input}
        />
        {trailing && <div className="absolute inset-y-0 right-0 flex items-center">{trailing}</div>}
      </div>
      {hint && (
        <p id={hintId} className="mt-1.5 text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

/** Eingabefeld für Passcodes mit Anzeigen/Verbergen. Der Passcode landet nie in einem Attribut oder Log. */
export function PasscodeField(props: Omit<TextFieldProps, 'type' | 'trailing'>) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-pressed={visible}
          aria-label={visible ? m.common.hidePasscode : m.common.showPasscode}
          className="inline-flex size-11 items-center justify-center rounded-control text-ink-muted hover:text-ink"
        >
          {visible ? (
            <EyeOff aria-hidden="true" className="size-5" />
          ) : (
            <Eye aria-hidden="true" className="size-5" />
          )}
        </button>
      }
    />
  );
}
