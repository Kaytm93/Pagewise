import { ArrowUp, Square } from 'lucide-react';
import {
  type FormEvent,
  type KeyboardEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { format, messages as m } from '../../i18n';
import { FieldError } from '../../ui/FieldError';

/** Gleiche Grenze wie auf dem Server (`MESSAGE_MAX_CHARACTERS`). */
export const MESSAGE_MAX_CHARACTERS = 50_000;

/** Entwürfe bleiben beim Wechsel zwischen Chats erhalten, aber nur im Speicher dieser Seite. */
const drafts = new Map<string, string>();

function hasFinePointer(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
}

interface Props {
  chatId: string;
  /** Ohne Modell lässt sich nichts senden. */
  disabled: boolean;
  /** Eine Antwort läuft: statt „Senden“ gibt es „Stoppen“. */
  running: boolean;
  stopping: boolean;
  /** Sendet die Nachricht; `true`, sobald der Server sie angenommen hat. */
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
}

export function Composer({ chatId, disabled, running, stopping, onSend, onStop }: Props) {
  const [draft, setDraft] = useState(() => drafts.get(chatId) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Neuester Entwurf, auch wenn eine still laufende Übertragung (Senden) ihn schon längst nicht mehr sieht. */
  const latest = useRef(draft);
  const field = useRef<HTMLTextAreaElement>(null);
  /** Stop-Knopf: nur wenn er selbst den Fokus hatte, gibt der Composer ihn nach dem Stopp zurück. */
  const stop = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const hintId = useId();
  const fine = hasFinePointer();

  // Das Feld wächst mit dem Text. Die Höhe setzt das Skript über das CSSOM (siehe D-023).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `draft` löst die neue Messung aus
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    if (element.scrollHeight > 0) element.style.height = `${element.scrollHeight}px`;
  }, [draft]);

  function update(text: string) {
    latest.current = text;
    setDraft(text);
    setError(null);
    if (text === '') drafts.delete(chatId);
    else drafts.set(chatId, text);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy || running || disabled || draft.trim() === '') return;
    if ([...draft].length > MESSAGE_MAX_CHARACTERS) {
      setError(format(m.chat.tooLong, { max: MESSAGE_MAX_CHARACTERS.toLocaleString('de-DE') }));
      return;
    }
    setBusy(true);
    const sent = draft;
    const accepted = await onSend(sent);
    setBusy(false);
    // Nur leeren, wenn der Nutzer inzwischen nicht schon weitergetippt hat: Der Zettel, den eine
    // Übertragung zurückliest, ist beim Eintreffen der Annahme oft schon veraltet.
    if (accepted && latest.current === sent) update('');
    field.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    if (event.metaKey || event.ctrlKey || fine) {
      event.preventDefault();
      void submit();
    }
  }

  // Der Stop-Knopf verschwindet beim Stopp; damit der Fokus nicht auf BODY fällt, merkt der Composer
  // hier (auch für Tastatur und Screenreader), wer ihn hatte, und gibt ihn wie nach dem Senden zurück.
  function markStopFocus() {
    returnFocus.current = document.activeElement === stop.current;
  }

  useLayoutEffect(() => {
    if (running || !returnFocus.current) return;
    returnFocus.current = false;
    field.current?.focus();
  }, [running]);

  const buttonBase =
    'mo-press inline-flex size-11 shrink-0 items-center justify-center rounded-[12px] disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <form onSubmit={submit}>
      <div className="flex items-end gap-2">
        <label htmlFor={`${hintId}-field`} className="sr-only">
          {m.chat.composerLabel}
        </label>
        <textarea
          id={`${hintId}-field`}
          ref={field}
          rows={1}
          value={draft}
          disabled={disabled}
          placeholder={m.chat.placeholder}
          enterKeyHint="send"
          autoComplete="off"
          aria-describedby={hintId}
          aria-invalid={error ? true : undefined}
          onChange={(event) => update(event.target.value)}
          onKeyDown={onKeyDown}
          className="max-h-48 min-h-11 min-w-0 flex-1 resize-none rounded-[16px] border border-control-edge bg-sheet px-4 py-2.5 text-[1.0313rem] leading-snug text-ink shadow-[0_1px_2px_rgba(var(--shadow),0.08)] transition-shadow duration-[var(--t-med)] placeholder:text-ink-muted focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)] focus:outline-none disabled:opacity-60"
        />
        {running ? (
          <button
            type="button"
            ref={stop}
            onClick={onStop}
            onFocus={markStopFocus}
            disabled={stopping}
            aria-label={stopping ? m.chat.stopping : m.chat.stop}
            className={`${buttonBase} border border-control-edge bg-sheet text-ink hover:bg-paper`}
          >
            <Square aria-hidden="true" className="size-4 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={disabled || busy || draft.trim() === ''}
            aria-label={m.chat.send}
            className={`${buttonBase} lg-btn-primary bg-primary text-on-primary hover:opacity-90`}
          >
            <ArrowUp aria-hidden="true" className="size-5" />
          </button>
        )}
      </div>
      <p id={hintId} className="mt-1.5 hidden text-meta text-ink-muted md:block">
        {fine ? m.chat.keyboardHintFine : m.chat.keyboardHintCoarse}
      </p>
      {error && <FieldError>{error}</FieldError>}
    </form>
  );
}
