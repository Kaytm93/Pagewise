import {
  ArrowLeft,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
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
import { Modal, ModalFooter } from '../../ui/modal';
import { Sheet } from '../../ui/Sheet';
import { iconButton, textLink } from '../../ui/styles';
import { useDesign } from '../../ui/useDesign';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { ChatEdgeMotif, ChatStatus, chatPhase } from '../atelier/SubjectAtelierChat';
import { commonErrorMessage } from '../auth-errors';
import { NotFoundPage } from '../NotFoundPage';
import { autoFixRequest, mayContainBlocks } from './autofix';
import { ChatHead } from './ChatHead';
import { Composer } from './Composer';
import { takeQueuedSend } from './default-chat';
import { FilePanel } from './FilePanel';
import { MessageItem } from './MessageItem';
import { ModelDialog } from './ModelDialog';
import { describeEngine, describeSelection, effectiveModel, effectiveTarget } from './models';
import { useChat } from './useChat';

const toSettings = { name: 'settings' } as const;

type Dialog = 'rename' | 'delete' | 'model' | null;

/** Ab dieser Fensterbreite darf das Panel aufklappen; darunter bleibt es eingeklappt (D-106). */
const PANEL_MIN_WIDTH = 900;
/** Breite des aufgeklappten Panels, Standard und untere Grenze des Resizers (in Pixeln). */
const PANEL_DEFAULT_WIDTH = 320;
const PANEL_MIN_COLUMN = 240;
/** Obere Grenze des Resizers: mehr als die Hälfte des Fensters bekommt das Panel nie. */
const PANEL_SHARE_MAX = 0.5;

/** Sitzungsgemerkter Zustand des Panels (auf-/zugeklappt, Breite) im Speicher dieser Seite. */
const panelState = { open: null as boolean | null, width: PANEL_DEFAULT_WIDTH };

/** Ist das Fenster breit genug für das aufgeklappte Panel? Fehlt matchMedia (Tests): nein. */
function panelFits(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia(`(min-width: ${PANEL_MIN_WIDTH}px)`).matches
  );
}

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
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            {m.common.cancel}
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            {m.common.save}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

export function ChatPage({ subjectId, chatId }: { subjectId: string; chatId: string }) {
  const { api } = useSession();
  const { findSubject, providers, modelSettings, engines } = useWorkspace();
  const chat = useChat(api, chatId);
  const { state } = chat;
  const design = useDesign();
  const lagen = design === 'lagen';
  const atelier = design === 'atelier';
  const [dialog, setDialog] = useState<Dialog>(null);
  const [announcement, setAnnouncement] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  // Datei-Panel (D-106): eingeklappt, solange das Fenster zu schmal ist (< 900 px), sonst wie zuletzt.
  const [panelOpen, setPanelOpen] = useState(() =>
    panelState.open === null ? panelFits() : panelState.open,
  );
  const [panelWidth, setPanelWidth] = useState(panelState.width);
  panelState.open = panelOpen;
  panelState.width = panelWidth;
  const panelArea = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  const previousLive = useRef<string | null>(null);
  const loadedChatId = state.phase === 'ready' ? (state.chat?.id ?? null) : null;

  // Wird das Fenster schmaler als die Grenze, klappt das Panel von selbst zu (und bleibt zu, bis es
  // auf einem breiten Fenster wieder von Hand oder über die Voreinstellung aufgeht). Ohne
  // matchMedia (Tests) oder ohne addEventListener (gedeckelter Ersatz) bleibt der Zustand, wie er ist.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(`(max-width: ${PANEL_MIN_WIDTH - 1}px)`);
    if (typeof query.addEventListener !== 'function') return;
    const onChange = () => {
      if (query.matches) setPanelOpen(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Die Breite des Panels geht nie als Inline-Stil ins Markup (CSP, Regel 5), sondern als CSS-Variable
  // über das CSSOM; die Spaltenbreite selbst steht in styles/screens.css (lg-chat-mit-panel).
  useLayoutEffect(() => {
    const area = panelArea.current;
    if (!area) return;
    if (panelOpen) area.style.setProperty('--panel-w', `${Math.round(panelWidth)}px`);
    else area.style.removeProperty('--panel-w');
  }, [panelOpen, panelWidth]);

  /** Ziehen am Resizer: Differenz zur Fensterkante, an Grenzen geklemmt, ohne Inline-Stil im Markup. */
  const startPanelResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const area = panelArea.current;
    if (!area || event.button !== 0) return;
    event.preventDefault();
    const rightEdge = area.getBoundingClientRect().right;
    const move = (moveEvent: PointerEvent) => {
      const next = Math.round(rightEdge - moveEvent.clientX);
      const capped = Math.round(window.innerWidth * PANEL_SHARE_MAX);
      setPanelWidth(Math.max(PANEL_MIN_COLUMN, Math.min(capped, next)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

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
      <Sheet flush>
        <p role="status" className="text-ink-secondary">
          {m.chat.loading}
        </p>
      </Sheet>
    );
  }
  if (state.phase === 'error' || !state.chat) {
    return (
      <Sheet flush>
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
          <p className="text-ink-secondary">{m.chat.loadFailed}</p>
          <Button variant="secondary" onClick={() => void chat.reload()}>
            {m.common.retry}
          </Button>
        </div>
      </Sheet>
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

  async function send(text: string, files: File[] = []): Promise<boolean> {
    pinned.current = true;
    setActionError(null);
    chat.dismissProblem();
    return chat.send(text, files);
  }

  const sourceText = model ? m.chat.source[model.source] : null;
  const modelLabel = model ? model.label : m.chat.modelNone;
  const modelSource = sourceText && model?.source !== 'default' ? sourceText : null;
  const modelAriaLabel = `${m.chat.modelButton}: ${modelLabel}${modelSource ? ` (${modelSource})` : ''}`;
  const inheritedName =
    describeEngine(engines.profiles, subject.engineProfileId) ??
    describeSelection(providers, subject.model ?? modelSettings.default);

  const phase = chatPhase({
    running: chat.running || current.generating,
    thinking: state.thinking,
    last,
  });

  return (
    <Sheet flush>
      {/* „Atelier“: das Fachmotiv am Rand, neben der Lesespalte (reine Zier, nur bei breitem Fenster). */}
      {atelier && subject.kind !== 'default' && <ChatEdgeMotif kind={subject.icon} />}
      <div
        ref={panelArea}
        className={panelOpen ? 'lg-chat-mit-panel' : 'lg-chat-panel-bereich'}
        data-panel={panelOpen ? 'open' : 'closed'}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          {lagen ? (
            <ChatHead
              title={title}
              backTo={backTo}
              backName={group?.name ?? subject.name}
              modelLabel={modelLabel}
              modelAriaLabel={modelAriaLabel}
              modelSource={modelSource}
              onModel={() => setDialog('model')}
              onFilesToggle={() => setPanelOpen((open) => !open)}
              filesOpen={panelOpen}
              onRename={() => setDialog('rename')}
              onDelete={() => setDialog('delete')}
            />
          ) : (
            <header
              className={`border-b border-line-warm px-4 py-3 sm:px-8 md:pl-10${atelier ? ' at-chat-head' : ''}`}
            >
              <Link
                to={backTo}
                className="mo-press inline-flex min-h-11 items-center gap-1.5 text-sm"
              >
                <ArrowLeft aria-hidden="true" className="size-4" />
                {group?.name ?? subject.name}
              </Link>
              <div className="flex items-start justify-between gap-2">
                <h1
                  id="chat-title"
                  className="min-w-0 py-1.5 font-heading text-[21px] break-words tracking-[-0.2px]"
                >
                  {title}
                </h1>
                <div className="-mr-2 flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => setPanelOpen((open) => !open)}
                    aria-label={panelOpen ? m.chat.files.close : m.chat.files.open}
                    aria-expanded={panelOpen}
                    className={iconButton}
                  >
                    {panelOpen ? (
                      <PanelRightClose aria-hidden="true" className="size-4" />
                    ) : (
                      <PanelRightOpen aria-hidden="true" className="size-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialog('rename')}
                    aria-label={m.chat.rename}
                    className={iconButton}
                  >
                    <Pencil aria-hidden="true" className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialog('delete')}
                    aria-label={m.chat.delete}
                    className={iconButton}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDialog('model')}
                aria-label={modelAriaLabel}
                className="mo-tap -ml-2.5 inline-flex min-h-11 max-w-full items-center gap-2 rounded-control px-2.5 text-sm text-ink-secondary hover:bg-paper hover:text-ink"
              >
                <SlidersHorizontal aria-hidden="true" className="size-4 shrink-0" />
                <span className="truncate">{modelLabel}</span>
                {modelSource && (
                  <span className="hidden shrink-0 text-meta text-ink-muted sm:inline">
                    {modelSource}
                  </span>
                )}
              </button>
              {atelier && <ChatStatus phase={phase} />}
            </header>
          )}

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
                    engines.profiles.find((profile) => profile.id === message.engineProfileId)
                      ?.kind ?? null
                  }
                  assetUrl={api.assetUrl}
                  onRetryViaApi={apiModel ? () => void chat.retry(true) : undefined}
                  saveNote={{
                    subjectId,
                    save: (messageId) => api.noteFromMessage(chatId, messageId),
                  }}
                />
              ))
            )}
            <p role="status" className="sr-only">
              {announcement}
            </p>
          </section>

          <div
            ref={watchComposer}
            onInput={chat.dismissProblem}
            className={`sticky bottom-[var(--kb,0px)] z-10 rounded-b-[12px] border-t border-line-warm bg-sheet px-4 pt-3.5 pb-3.5 sm:px-8${atelier ? ' at-chat-dock' : ''}`}
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
                  <Link to={toSettings} className={`mt-1 ${textLink}`}>
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
                subjectColor={subject.color}
              />
              {lagen && (
                <p className="lg-chat-hint">
                  {modelLabel} · {m.chat.verifyAnswers}
                </p>
              )}
            </div>
          </div>
        </div>

        {panelOpen && (
          <>
            {/* Resizer zwischen Chat-Spalte und Panel: zustandslos gezogen, nur ein Grabber über CSS.
                Biome wünscht hier ein hr — der Ziehgriff ist aber eine Bedienfläche mit Zeiger-Ereignis
                und eigenem zugänglichen Namen, darum bleibt das div mit Separator-Rolle. */}
            {/* biome-ignore lint/a11y/useSemanticElements: der Resizer trägt Zeiger-Ereignisse und Fokus-Verhalten, kein Trennstrich */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={m.chat.files.panel}
              onPointerDown={startPanelResize}
              className="lg-chat-panel-resizer hidden shrink-0 cursor-col-resize md:block"
            >
              <span aria-hidden="true" className="lg-chat-panel-griff" />
            </div>
            <aside
              aria-label={m.chat.files.panel}
              className="hidden min-h-0 shrink-0 flex-col overflow-hidden border-l border-line-warm md:flex lg-chat-panel"
            >
              <div className="min-h-0 flex-1 pt-3">
                <FilePanel chatId={chatId} />
              </div>
            </aside>
          </>
        )}
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
