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
  const field = useRef<HTMLTextAreaElement>(null);
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
    const accepted = await onSend(draft);
    setBusy(false);
    if (accepted) update('');
    field.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    if (event.metaKey || event.ctrlKey || fine) {
      event.preventDefault();
      void submit();
    }
  }

  const buttonBase =
    'inline-flex size-11 shrink-0 items-center justify-center rounded-pill transition-colors disabled:cursor-not-allowed disabled:opacity-50';

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
          className="max-h-48 min-h-11 min-w-0 flex-1 resize-none rounded-control border border-control-edge bg-canvas px-3.5 py-2.5 text-base leading-snug text-ink placeholder:text-ink-muted disabled:opacity-60"
        />
        {running ? (
          <button
            type="button"
            onClick={onStop}
            disabled={stopping}
            aria-label={stopping ? m.chat.stopping : m.chat.stop}
            className={`${buttonBase} border border-control-edge bg-canvas text-ink hover:bg-paper`}
          >
            <Square aria-hidden="true" className="size-4 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={disabled || busy || draft.trim() === ''}
            aria-label={m.chat.send}
            className={`${buttonBase} bg-primary text-on-primary hover:opacity-90`}
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
