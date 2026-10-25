import { ArrowUp, Paperclip, Square, X } from 'lucide-react';
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { format, messages as m } from '../../i18n';
import { FieldError } from '../../ui/FieldError';
import { subjectColorAttr } from '../../ui/subject-color';
import { useDesign } from '../../ui/useDesign';

/** Gleiche Grenze wie auf dem Server (`MESSAGE_MAX_CHARACTERS`). */
export const MESSAGE_MAX_CHARACTERS = 50_000;

/** Gleiche Grenzen wie auf dem Server (`MAX_ATTACHMENTS`, `MAX_ASSET_BYTES`). */
export const MAX_ATTACHMENTS = 4;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Ein vom Nutzer beigelegter Dateianhang, bis das Senden ihn übernimmt. */
export interface PendingFile {
  id: string;
  file: File;
}

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
  onSend: (text: string, files: File[]) => Promise<boolean>;
  onStop: () => void;
  /** Fachfarbe 0 bis 7 (oder `null`): geht als `data-subj` an die Wurzel, damit die Richtung ein Fachglühen setzen kann. */
  subjectColor?: number | null;
}

let pendingId = 0;

export function Composer({
  chatId,
  disabled,
  running,
  stopping,
  onSend,
  onStop,
  subjectColor,
}: Props) {
  const [draft, setDraft] = useState(() => drafts.get(chatId) ?? '');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Neuester Entwurf, auch wenn eine still laufende Übertragung (Senden) ihn schon längst nicht mehr sieht. */
  const latest = useRef(draft);
  const latestFiles = useRef(files);
  const field = useRef<HTMLTextAreaElement>(null);
  const chooser = useRef<HTMLInputElement>(null);
  /** Stop-Knopf: nur wenn er selbst den Fokus hatte, gibt der Composer ihn nach dem Stopp zurück. */
  const stop = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const hintId = useId();
  const fine = hasFinePointer();
  const lagen = useDesign() === 'lagen';

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
    if (text === '' && latestFiles.current.length === 0) drafts.delete(chatId);
    else drafts.set(chatId, text);
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    setFiles((current) => {
      const next = [...current];
      for (const file of list) {
        // Erst die Größe: eine zu große Datei wird benannt, auch wenn die Anzahl schon voll ist.
        if (file.size > MAX_FILE_BYTES) {
          setError(format(m.chat.fileTooLarge, { name: file.name }));
          continue;
        }
        if (next.length >= MAX_ATTACHMENTS) {
          setError(format(m.chat.tooManyFiles, { max: MAX_ATTACHMENTS }));
          break;
        }
        next.push({ id: `pf-${pendingId}`, file });
        pendingId += 1;
      }
      latestFiles.current = next;
      return next;
    });
  }

  function onChosen(event: ChangeEvent<HTMLInputElement>) {
    addFiles(event.target.files);
    event.target.value = '';
  }

  function removeFile(id: string) {
    setFiles((current) => {
      const next = current.filter((entry) => entry.id !== id);
      latestFiles.current = next;
      return next;
    });
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy || running || disabled) return;
    if (draft.trim() === '' && files.length === 0) return;
    if ([...draft].length > MESSAGE_MAX_CHARACTERS) {
      setError(format(m.chat.tooLong, { max: MESSAGE_MAX_CHARACTERS.toLocaleString('de-DE') }));
      return;
    }
    setBusy(true);
    const sent = draft;
    const sentFiles = files.map((entry) => entry.file);
    const accepted = await onSend(sent, sentFiles);
    setBusy(false);
    // Nur leeren, wenn der Nutzer inzwischen nicht schon weitergetippt hat: Der Zettel, den eine
    // Übertragung zurückliest, ist beim Eintreffen der Annahme oft schon veraltet.
    if (accepted && latest.current === sent) {
      update('');
      if (latestFiles.current === files) {
        latestFiles.current = [];
        setFiles([]);
      }
    }
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
    'mo-press inline-flex size-11 shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-50';
  const buttonShape = lagen ? 'rounded-full' : 'rounded-[12px]';

  return (
    <form
      onSubmit={submit}
      className="lg-composer"
      data-subj={subjectColorAttr(subjectColor)}
      data-running={running || undefined}
    >
      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label={m.chat.attachments}>
          {files.map((entry) => (
            <li
              key={entry.id}
              className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-control border border-line bg-paper px-3 text-sm text-ink"
            >
              <span className="min-w-0 truncate">{entry.file.name}</span>
              <button
                type="button"
                onClick={() => removeFile(entry.id)}
                aria-label={format(m.chat.removeAttachment, { name: entry.file.name })}
                className="mo-press inline-flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted hover:text-ink"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={lagen ? 'lg-composer-field' : 'flex items-end gap-2'}>
        <input
          ref={chooser}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.pdf,.pptx,.docx,.xlsx,.txt,.md,.csv"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={onChosen}
        />
        <button
          type="button"
          onClick={() => chooser.current?.click()}
          disabled={disabled || running || files.length >= MAX_ATTACHMENTS}
          aria-label={m.chat.attach}
          aria-keyshortcuts="Control+U"
          className={`${buttonBase} ${buttonShape} border border-control-edge bg-sheet text-ink hover:bg-paper`}
        >
          <Paperclip aria-hidden="true" className="size-5" />
        </button>
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
          onKeyDown={(event) => {
            if (event.key.toLowerCase() === 'u' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              chooser.current?.click();
              return;
            }
            onKeyDown(event);
          }}
          className={
            lagen
              ? 'lg-composer-input min-w-0 flex-1 resize-none text-[1.0313rem] leading-snug text-ink placeholder:text-ink-muted disabled:opacity-60'
              : 'max-h-48 min-h-11 min-w-0 flex-1 resize-none rounded-[16px] border border-control-edge bg-sheet px-4 py-2.5 text-[1.0313rem] leading-snug text-ink shadow-[0_1px_2px_rgba(var(--shadow),0.08)] transition-shadow duration-[var(--t-med)] placeholder:text-ink-muted focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)] focus:outline-none disabled:opacity-60'
          }
        />
        {running ? (
          <button
            type="button"
            ref={stop}
            onClick={onStop}
            onFocus={markStopFocus}
            disabled={stopping}
            aria-label={stopping ? m.chat.stopping : m.chat.stop}
            className={`${buttonBase} ${buttonShape} border border-control-edge bg-sheet text-ink hover:bg-paper`}
          >
            <Square aria-hidden="true" className="size-4 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={disabled || busy || (draft.trim() === '' && files.length === 0)}
            aria-label={m.chat.send}
            className={`${buttonBase} ${buttonShape} lg-btn-primary bg-primary text-on-primary hover:opacity-90`}
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
