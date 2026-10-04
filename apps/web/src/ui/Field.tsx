import { Eye, EyeOff } from 'lucide-react';
import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
  useState,
} from 'react';
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
  'min-h-11 w-full rounded-control border border-control-edge bg-sheet px-3 text-base text-ink transition-shadow duration-[var(--t-med)] focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)] focus:outline-none disabled:opacity-60';

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

interface SecretFieldProps extends Omit<TextFieldProps, 'type' | 'trailing'> {
  showLabel: string;
  hideLabel: string;
}

/** Eingabefeld für Geheimnisse mit Anzeigen/Verbergen. Der Wert landet nie in einem Attribut oder Log. */
export function SecretField({ showLabel, hideLabel, ...props }: SecretFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      autoComplete="off"
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
          aria-label={visible ? hideLabel : showLabel}
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

/** Eingabefeld für Passcodes. */
export function PasscodeField(props: Omit<TextFieldProps, 'type' | 'trailing'>) {
  return (
    <SecretField showLabel={m.common.showPasscode} hideLabel={m.common.hidePasscode} {...props} />
  );
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
  /** Blendet die Beschriftung aus, sie bleibt für Screenreader erhalten. */
  hideLabel?: boolean;
}

/** Auswahlliste mit dem Aussehen der Eingabefelder. Auf dem Handy öffnet sie die Auswahl des Systems. */
export function SelectField({
  label,
  hint,
  error,
  hideLabel,
  className = '',
  children,
  ...select
}: SelectFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={className}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'block text-sm font-medium text-ink'}>
        {label}
      </label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`${inputClass} ${hideLabel ? '' : 'mt-1.5'}`}
        {...select}
      >
        {children}
      </select>
      {hint && (
        <p id={hintId} className="mt-1.5 text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
  /** Niedriges Feld für kurze Notizen statt der hohen Fläche für Prompts. */
  compact?: boolean;
}

/** Mehrzeiliges Textfeld (z. B. für Prompts). Die Höhe lässt sich ziehen. */
export function TextAreaField({
  label,
  hint,
  error,
  compact = false,
  className = '',
  ...textarea
}: TextAreaFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`mt-1.5 ${compact ? 'min-h-24' : 'min-h-60'} w-full resize-y rounded-control border border-control-edge bg-sheet px-3 py-2.5 text-base leading-relaxed text-ink disabled:opacity-60`}
        {...textarea}
      />
      {hint && (
        <p id={hintId} className="mt-1.5 text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

interface CheckFieldProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** Ein Kästchen mit Beschriftung und kurzer Erklärung. Die ganze Zeile ist antippbar. */
export function CheckField({ label, hint, checked, onChange }: CheckFieldProps) {
  const hintId = useId();
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5">
      <input
        type="checkbox"
        className="mt-0.5 size-5 shrink-0 accent-primary"
        checked={checked}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint && (
          <span id={hintId} className="mt-0.5 block text-sm text-ink-muted">
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}
