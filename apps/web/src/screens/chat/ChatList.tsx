import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Chat } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { navigate } from '../../router';
import { useSession } from '../../session/SessionProvider';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { FieldError } from '../../ui/FieldError';
import { Link } from '../../ui/Link';
import { listRow } from '../../ui/styles';
import { formatWhen } from './when';

/** Chats eines Fachs oder einer Untergruppe mit „Neuer Chat“. Chats bleiben immer in ihrem Fach. */
export function ChatList({ subjectId, groupId }: { subjectId: string; groupId: string | null }) {
  const { api } = useSession();
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Chat | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setChats(null);
    setFailed(false);
    api
      .chats(subjectId, groupId)
      .then((list) => {
        if (!cancelled) setChats(list);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, subjectId, groupId]);

  const open = (chat: Chat) => navigate({ name: 'chat', subjectId, chatId: chat.id });

  async function create() {
    setError(null);
    // Ein noch leerer Chat wird weiterverwendet, statt einen zweiten anzulegen.
    const empty = chats?.find((chat) => chat.title === '');
    if (empty) {
      open(empty);
      return;
    }
    setCreating(true);
    try {
      open(await api.createChat(subjectId, groupId));
    } catch {
      setError(m.subject.chatCreateFailed);
      setCreating(false);
    }
  }

  async function remove(chat: Chat) {
    setBusy(true);
    try {
      await api.deleteChat(chat.id);
      setChats((current) => current?.filter((entry) => entry.id !== chat.id) ?? current);
      setDeleting(null);
    } catch {
      setDeleting(null);
      setError(m.errors.unknown);
    }
    setBusy(false);
  }

  return (
    <section className="mt-6" aria-labelledby="chats-heading">
      <div className="flex items-center justify-end gap-4">
        {/* Die Überschrift steht jetzt als Reiter über der Liste; für Screenreader bleibt sie als Abschnittstitel */}
        <h2 id="chats-heading" className="sr-only">
          {m.subject.chats}
        </h2>
        <Button variant="primary" busy={creating} onClick={() => void create()}>
          <Plus aria-hidden="true" className="size-4" />
          {m.subject.newChat}
        </Button>
      </div>

      {error && <FieldError>{error}</FieldError>}
      {failed && <p className="mt-3 text-ink-secondary">{m.subject.chatsFailed}</p>}
      {!failed && chats === null && (
        <div role="status" className="mt-3">
          <span className="sr-only">{m.subject.chatsLoading}</span>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              aria-hidden="true"
              className="grid gap-2.5 border-b border-line-warm px-2 py-[18px]"
            >
              <span className="mo-shimmer h-[17px] w-[46%] rounded-[7px] bg-ink-muted/20" />
              <span className="mo-shimmer h-[13px] w-[78%] rounded-[7px] bg-ink-muted/20" />
            </div>
          ))}
        </div>
      )}
      {chats && chats.length === 0 && (
        <div className="mt-3 rounded-box bg-paper p-4">
          <p className="font-medium">{m.subject.noChatsTitle}</p>
          <p className="mt-1 text-sm text-ink-secondary">{m.subject.noChatsHint}</p>
        </div>
      )}
      {chats && chats.length > 0 && (
        <ul className="mt-3 divide-y divide-line-warm border-y border-line-warm">
          {chats.map((chat) => {
            const title = chat.title === '' ? m.subject.chatUntitled : chat.title;
            return (
              <li key={chat.id} className="flex items-center">
                <Link to={{ name: 'chat', subjectId, chatId: chat.id }} className={listRow}>
                  <span className="truncate font-heading text-[19px] tracking-[-0.15px]">
                    {title}
                  </span>
                  <span className="truncate text-sm text-ink-muted">
                    {chat.generating ? m.subject.chatGenerating : formatWhen(chat.updatedAt)}
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => setDeleting(chat)}
                  aria-label={format(m.subject.chatDeleteNamed, { name: title })}
                  className="mo-press -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] text-ink-muted hover:bg-paper hover:text-ink"
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {deleting && (
        <ConfirmDialog
          title={format(m.confirm.deleteChatTitle, {
            name: deleting.title === '' ? m.subject.chatUntitled : deleting.title,
          })}
          description={m.confirm.deleteChatBody}
          confirmLabel={m.common.delete}
          busy={busy}
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
