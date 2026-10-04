import { ArrowUp } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messages as m } from '../../i18n';
import { navigate } from '../../router';
import { useSession } from '../../session/SessionProvider';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { emptyDefaultChat, queueSend } from '../chat/default-chat';

/** Gleiche Grenze wie im Chat (`MESSAGE_MAX_CHARACTERS`). */
const MAX_CHARACTERS = 50_000;

/**
 * Die Frage ohne Fach direkt von der Startseite: öffnet einen leeren Chat im Fach „Standard“ und sendet die
 * Frage dort. Der Chat zeigt dann die Antwort wie jeder andere.
 */
export function AskForm() {
  const { api } = useSession();
  const { defaultSubject } = useWorkspace();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const question = text.trim();
    if (question === '' || busy || [...question].length > MAX_CHARACTERS) return;
    setBusy(true);
    setFailed(false);
    try {
      const chat = await emptyDefaultChat(api, defaultSubject.id);
      queueSend(chat.id, question);
      navigate({ name: 'chat', subjectId: defaultSubject.id, chatId: chat.id });
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 max-w-[640px]">
      <div className="flex min-h-14 items-center gap-1.5 border-b-2 border-ink pr-0.5 focus-within:border-accent">
        <label htmlFor="home-ask" className="sr-only">
          {m.home.askLabel}
        </label>
        <input
          id="home-ask"
          type="text"
          value={text}
          maxLength={MAX_CHARACTERS}
          autoComplete="off"
          enterKeyHint="send"
          onChange={(event) => setText(event.target.value)}
          placeholder={m.home.askPlaceholder}
          className="min-h-[54px] min-w-0 flex-1 bg-transparent px-1 text-[19px] text-ink outline-none placeholder:text-ink-muted"
        />
        <button
          type="submit"
          disabled={busy || text.trim() === ''}
          aria-label={m.home.askSend}
          className="lg-btn-primary mo-press inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary disabled:opacity-40"
        >
          <ArrowUp aria-hidden="true" className="size-5" />
        </button>
      </div>
      {failed && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {m.home.askFailed}
        </p>
      )}
    </form>
  );
}
