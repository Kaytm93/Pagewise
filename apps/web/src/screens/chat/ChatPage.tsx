import { ArrowLeft, Pencil, SlidersHorizontal, Trash2 } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { format, messages as m } from '../../i18n';
import { navigate } from '../../router';
import { useSession } from '../../session/SessionProvider';
import { readAutoFix } from '../../ui/autofix';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { TextField } from '../../ui/Field';
import { FieldError } from '../../ui/FieldError';
import { Link } from '../../ui/Link';
import { Modal } from '../../ui/modal';
import { Sheet } from '../../ui/Sheet';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { commonErrorMessage } from '../auth-errors';
import { NotFoundPage } from '../NotFoundPage';
import { autoFixRequest, mayContainBlocks } from './autofix';
import { Composer } from './Composer';
import { takeQueuedSend } from './default-chat';
import { MessageItem } from './MessageItem';
import { ModelDialog } from './ModelDialog';
import { describeEngine, describeSelection, effectiveModel, effectiveTarget } from './models';
import { useChat } from './useChat';

type Dialog = 'rename' | 'delete' | 'model' | null;

/** Wie nah am Ende die Ansicht sein muss, damit sie neuen Text mitverfolgt (in Pixeln). */
const FOLLOW_DISTANCE = 160;

function scrollToEnd() {
  const element = document.scrollingElement;
  if (element) element.scrollTop = element.scrollHeight;
}

function nearEnd(): boolean {
  const element = document.scrollingElement;
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_DISTANCE;
}

function problemText(code: string): string {
  const problems = m.chat.problems as Record<string, string>;
  return problems[code] ?? m.chat.problems.unknown;
}

function RenameDialog({
  title,
  onSave,
  onClose,
}: {
  title: string;
  onSave: (title: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed === '' || [...trimmed].length > 120) {
      setError(m.chat.renameInvalid);
      return;
    }
    setBusy(true);
    try {
      await onSave(trimmed);
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === 'invalid_input'
          ? m.chat.renameInvalid
          : commonErrorMessage(caught),
      );
      setBusy(false);
    }
  }

  return (
    <Modal title={m.chat.renameTitle} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <TextField
          label={m.chat.renameLabel}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          error={error}
          maxLength={120}
          autoComplete="off"
          data-autofocus
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            {m.common.cancel}
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            {m.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ChatPage({ subjectId, chatId }: { subjectId: string; chatId: string }) {
  const { api } = useSession();
  const { findSubject, providers, modelSettings, engines } = useWorkspace();
  const chat = useChat(api, chatId);
  const { state } = chat;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [announcement, setAnnouncement] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const pinned = useRef(true);
  const previousLive = useRef<string | null>(null);
  const loadedChatId = state.phase === 'ready' ? (state.chat?.id ?? null) : null;

  // Eine Frage von der Startseite wird gesendet, sobald der Chat geladen ist (einmal, dann ist sie weg).
  // biome-ignore lint/correctness/useExhaustiveDependencies: nur beim Laden eines Chats; `chat.send` ist stabil genug
  useEffect(() => {
    if (!loadedChatId) return;
    const queued = takeQueuedSend(loadedChatId);
    if (queued) void chat.send(queued);
  }, [loadedChatId]);

  // Mitlesen: ist man nah am Ende, folgt die Ansicht dem neuen Text; wer hochgescrollt hat, bleibt dort.
  useEffect(() => {
    const onScroll = () => {
      pinned.current = nearEnd();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Wächst das Eingabefeld (mehrere Zeilen), bleibt das Ende des Verlaufs sichtbar.
  const watchComposer = useCallback((element: HTMLDivElement | null) => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) scrollToEnd();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: bei jeder Änderung der Nachrichten ans Ende, falls angepinnt
  useLayoutEffect(() => {
    if (pinned.current) scrollToEnd();
  }, [state.messages, state.thinking]);

  // Screenreader hören keine einzelnen Textstücke, sondern nur Anfang und Ende einer Antwort.
  useEffect(() => {
    if (state.liveId) {
      setAnnouncement(m.chat.announceWriting);
    } else if (previousLive.current) {
      const last = state.messages[state.messages.length - 1];
      setAnnouncement(
        last?.status === 'stopped'
          ? m.chat.announceStopped
          : last?.status === 'error'
            ? m.chat.announceFailed
            : m.chat.announceDone,
      );
    }
    previousLive.current = state.liveId;
  }, [state.liveId, state.messages]);

  // Automatische Korrektur (höchstens einmal je Antwort): Ist eine Antwort eben fertig geworden und lässt sich
  // ein Block darin nicht zeichnen, geht einmal eine Anfrage mit den Fehlercodes an das Modell. Beim bloßen
  // Öffnen eines alten Chats passiert nichts: geprüft wird nur, was in dieser Ansicht gerade fertig wurde.
  const fixBase = useRef<string | null>(null);
  const sendRef = useRef(chat.send);
  sendRef.current = chat.send;
  useEffect(() => {
    const finishedId = state.liveId === null ? fixBase.current : null;
    fixBase.current = state.liveId;
    if (!finishedId || !readAutoFix()) return;
    const index = state.messages.findIndex((entry) => entry.id === finishedId);
    const message = state.messages[index];
    const before = state.messages[index - 1];
    if (message?.role !== 'assistant' || message.status !== 'complete') return;
    if (before?.role === 'user' && before.content.startsWith(m.chat.autoFix.prefix)) return;
    if (!mayContainBlocks(message.content)) return;
    void autoFixRequest(message.content)
      .then((text) => (text ? sendRef.current(text) : undefined))
      .catch(() => undefined);
  }, [state.liveId, state.messages]);

  const subject = findSubject(subjectId);
  if (state.phase === 'not-found') return <NotFoundPage />;
  if (!subject) return <NotFoundPage />;

  if (state.phase === 'loading') {
    return (
      <p role="status" className="mx-auto max-w-3xl px-4 py-8 text-ink-secondary">
        {m.chat.loading}
      </p>
    );
  }
  if (state.phase === 'error' || !state.chat) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        <p className="text-ink-secondary">{m.chat.loadFailed}</p>
        <Button variant="secondary" onClick={() => void chat.reload()}>
          {m.common.retry}
        </Button>
      </div>
    );
  }
  if (state.chat.subjectId !== subjectId) return <NotFoundPage />;

  const current = state.chat;
  const group = current.groupId
    ? subject.groups.find((entry) => entry.id === current.groupId)
    : undefined;
  const backTo = { name: 'subject', subjectId, groupId: group?.id ?? null } as const;
  const model = effectiveTarget(current, subject, modelSettings, providers, engines.profiles);
  // Ein Modell eines Anbieters, das statt eines fehlgeschlagenen Agenten antworten könnte.
  const apiModel = effectiveModel(current.model, subject, modelSettings, providers);
  const messages = state.messages;
  const last = messages[messages.length - 1];
  const canRetry =
    !chat.running &&
    last?.role === 'assistant' &&
    (last.status === 'error' || last.status === 'stopped' || last.status === 'interrupted');
  const title = current.title === '' ? m.chat.untitled : current.title;

  async function rename(next: string) {
    const updated = await api.updateChat(chatId, { title: next });
    chat.dispatch({ type: 'meta', chat: updated });
  }

  async function remove() {
    try {
      await api.deleteChat(chatId);
    } catch (caught) {
      if (!(caught instanceof ApiError && caught.code === 'not_found')) {
        setDialog(null);
        setActionError(commonErrorMessage(caught));
        return;
      }
    }
    navigate(backTo);
  }

  async function send(text: string): Promise<boolean> {
    pinned.current = true;
    setActionError(null);
    return chat.send(text);
  }

  const sourceText = model ? m.chat.source[model.source] : null;
  const inheritedName =
    describeEngine(engines.profiles, subject.engineProfileId) ??
    describeSelection(providers, subject.model ?? modelSettings.default);

  return (
    <Sheet flush>
      <header className="border-b border-line-warm px-4 py-3 sm:px-8 md:pl-10">
        <Link to={backTo} className="mo-press inline-flex min-h-11 items-center gap-1.5 text-sm">
          <ArrowLeft aria-hidden="true" className="size-4" />
          {group?.name ?? subject.name}
        </Link>
        <div className="flex items-start justify-between gap-2">
          <h1 className="min-w-0 py-1.5 font-heading text-[21px] break-words tracking-[-0.2px]">
            {title}
          </h1>
          <div className="-mr-2 flex shrink-0">
            <button
              type="button"
              onClick={() => setDialog('rename')}
              aria-label={m.chat.rename}
              className="inline-flex size-11 items-center justify-center rounded-control text-ink-muted hover:bg-paper hover:text-ink"
            >
              <Pencil aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setDialog('delete')}
              aria-label={m.chat.delete}
              className="inline-flex size-11 items-center justify-center rounded-control text-ink-muted hover:bg-paper hover:text-ink"
            >
              <Trash2 aria-hidden="true" className="size-4" />
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDialog('model')}
          aria-label={m.chat.modelButton}
          className="-ml-2.5 inline-flex min-h-11 max-w-full items-center gap-2 rounded-control px-2.5 text-sm text-ink-secondary hover:bg-paper hover:text-ink"
        >
          <SlidersHorizontal aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">{model ? model.label : m.chat.modelNone}</span>
          {sourceText && model?.source !== 'default' && (
            <span className="hidden shrink-0 text-meta text-ink-muted sm:inline">{sourceText}</span>
          )}
        </button>
      </header>

      <section
        aria-label={m.chat.messages}
        className="mx-auto w-full max-w-[700px] flex-1 space-y-6 px-4 py-8 sm:px-7"
      >
        {messages.length === 0 ? (
          <div className="rounded-box bg-paper p-4">
            <p className="font-medium">{m.chat.emptyTitle}</p>
            <p className="mt-1 text-sm text-ink-secondary">{m.chat.emptyHint}</p>
          </div>
        ) : (
          messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              live={message.id === state.liveId}
              thinking={state.thinking}
              canRetry={canRetry && message === last}
              onRetry={() => void chat.retry()}
              engineKind={
                engines.profiles.find((profile) => profile.id === message.engineProfileId)?.kind ??
                null
              }
              assetUrl={api.assetUrl}
              onRetryViaApi={apiModel ? () => void chat.retry(true) : undefined}
              saveNote={{ subjectId, save: (messageId) => api.noteFromMessage(chatId, messageId) }}
            />
          ))
        )}
        <p role="status" className="sr-only">
          {announcement}
        </p>
      </section>

      <div
        ref={watchComposer}
        className="sticky bottom-0 z-10 rounded-b-[12px] border-t border-line-warm bg-sheet px-4 pt-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:px-8"
      >
        <div className="mx-auto w-full max-w-[700px]">
          {chat.reconnecting && (
            <p role="status" className="mb-2 text-sm text-ink-secondary">
              {m.chat.reconnecting}
            </p>
          )}
          {chat.problem && (
            <div className="mb-2 flex flex-wrap items-center gap-x-3">
              <FieldError>{problemText(chat.problem)}</FieldError>
              {chat.problem === 'network' && (
                <Button variant="ghost" onClick={() => void chat.reconnect()}>
                  {m.chat.reconnect}
                </Button>
              )}
            </div>
          )}
          {actionError && <FieldError>{actionError}</FieldError>}
          {!model && (
            <div className="mb-3 rounded-box bg-paper px-4 py-3 text-sm">
              <p className="font-medium">{m.chat.noModelTitle}</p>
              <p className="mt-1 text-ink-secondary">{m.chat.noModelHint}</p>
              <Link to={{ name: 'settings' }} className="mt-1 inline-block">
                {m.chat.openSettings}
              </Link>
            </div>
          )}
          <Composer
            chatId={chatId}
            disabled={!model}
            running={chat.running || current.generating}
            stopping={chat.stopping}
            onSend={send}
            onStop={() => void chat.stop()}
          />
        </div>
      </div>

      {dialog === 'rename' && (
        <RenameDialog title={current.title} onSave={rename} onClose={() => setDialog(null)} />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title={format(m.confirm.deleteChatTitle, { name: title })}
          description={m.confirm.deleteChatBody}
          confirmLabel={m.common.delete}
          onConfirm={() => void remove()}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'model' && (
        <ModelDialog
          title={m.chat.modelDialog.chatTitle}
          lead={m.chat.modelDialog.chatLead}
          value={{ model: current.model, engineProfileId: current.engineProfileId }}
          inheritLabel={m.chat.modelDialog.inheritChat}
          inheritedName={inheritedName}
          onSave={async (choice) => {
            // Wer das eine wählt, hebt das andere auf dem Server auf; nur „keine Wahl“ nennt beides.
            const patch = choice.engineProfileId
              ? { engineProfileId: choice.engineProfileId }
              : choice.model
                ? { model: choice.model }
                : { model: null, engineProfileId: null };
            const updated = await api.updateChat(chatId, patch);
            chat.dispatch({ type: 'meta', chat: updated });
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </Sheet>
  );
}
