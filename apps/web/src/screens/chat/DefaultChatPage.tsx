import { useEffect, useRef, useState } from 'react';
import { messages as m } from '../../i18n';
import { navigate } from '../../router';
import { useSession } from '../../session/SessionProvider';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { useWorkspace } from '../../workspace/WorkspaceProvider';

/**
 * Standard-Chat (Klick auf „Pagewise“): ein Chat ohne Fach. Er liegt im eingebauten Fach „Standard“.
 * Die Seite öffnet einen noch leeren Chat dieses Fachs oder legt einen an und springt dorthin; frühere
 * Chats stehen auf der Seite des Fachs „Standard“. Ein leerer Chat wird weiterverwendet, damit kein
 * Stapel leerer Chats entsteht (wie bei „Neuer Chat“ in einem Fach).
 */
export function DefaultChatPage() {
  const { api } = useSession();
  const { defaultSubject } = useWorkspace();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  const startedAttempt = useRef(-1);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    // Im Entwicklungsmodus läuft jeder Effekt zweimal; ein Chat soll nur einmal entstehen.
    if (startedAttempt.current === attempt) return;
    startedAttempt.current = attempt;
    setFailed(false);
    (async () => {
      const chats = await api.chats(defaultSubject.id, null);
      const chat =
        chats.find((entry) => entry.title === '') ??
        (await api.createChat(defaultSubject.id, null));
      if (alive.current) {
        navigate(
          { name: 'chat', subjectId: defaultSubject.id, chatId: chat.id },
          { replace: true },
        );
      }
    })().catch(() => {
      if (alive.current) setFailed(true);
    });
  }, [api, defaultSubject.id, attempt]);

  return (
    <Sheet>
      {failed ? (
        <div>
          <p role="alert" className="text-ink-secondary">
            {m.defaultSubject.failed}
          </p>
          <Button variant="secondary" className="mt-4" onClick={() => setAttempt((n) => n + 1)}>
            {m.common.retry}
          </Button>
        </div>
      ) : (
        <p role="status" className="text-ink-secondary">
          {m.defaultSubject.opening}
        </p>
      )}
    </Sheet>
  );
}
