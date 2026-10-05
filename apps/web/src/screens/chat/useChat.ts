import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Api } from '../../api/api';
import { ApiError, isAbort } from '../../api/client';
import { parseStreamEvent, type SseMessage } from '../../api/sse';
import type { StreamEvent } from '../../api/types';
import { chatReducer, initialChatState } from './chat-state';

type Starter = (
  onMessage: (message: SseMessage) => void,
  signal: AbortSignal,
) => Promise<'streamed' | 'empty'>;

/** Wartezeiten vor dem erneuten Anhängen, wenn die Verbindung während einer Antwort abriss. */
const REATTACH_DELAYS_MS = [400, 1500, 3000, 6000];

function isEnd(event: StreamEvent): boolean {
  return event.type === 'done' || event.type === 'stopped' || event.type === 'failed';
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Lädt einen Chat und führt Senden, Wiederholen, Stoppen und Wiederanhängen aus. Die Antwort läuft auf
 * dem Server unabhängig von dieser Verbindung weiter: reißt sie ab (Gerät schläft, Netz wechselt), hängt
 * sich die Ansicht wieder an und ersetzt ihren Text durch den Stand des Servers.
 */
export function useChat(api: Api, chatId: string) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [running, setRunning] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [stopping, setStopping] = useState(false);
  /** Fehlercode, wenn Senden oder Verbinden nicht geklappt hat (kein Fehler einer Antwort). */
  const [problem, setProblem] = useState<string | null>(null);
  const dismissProblem = useCallback(() => setProblem(null), []);

  // Jeder Lauf bekommt eine Nummer; ein neuer Lauf oder das Verlassen der Ansicht macht alte ungültig.
  const runId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const generating = useRef(false);
  generating.current = state.chat?.generating ?? false;

  const loadDetail = useCallback(async (): Promise<void> => {
    try {
      dispatch({ type: 'loaded', detail: await api.chat(chatId) });
    } catch (error) {
      dispatch({
        type: 'load-failed',
        notFound: error instanceof ApiError && (error.code === 'not_found' || error.status === 404),
      });
    }
  }, [api, chatId]);

  /** Holt Titel und Wahl des Chats nach einer Antwort, ohne die Nachrichten anzufassen. */
  const refreshMeta = useCallback(async (): Promise<void> => {
    try {
      const { messages: _messages, ...chat } = await api.chat(chatId);
      dispatch({ type: 'meta', chat });
    } catch {
      // Der Titel bleibt dann bis zum nächsten Laden alt; das ist kein Grund zu stören.
    }
  }, [api, chatId]);

  const run = useCallback(
    async (
      starter: Starter,
      options: {
        /** Senden und Wiederholen verändern den Chat; ging die Anfrage verloren, wird nicht blind neu gesendet. */
        changes?: boolean;
        onAccepted?: (accepted: boolean) => void;
      } = {},
    ): Promise<void> => {
      const id = ++runId.current;
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;
      setRunning(true);
      setReconnecting(false);
      setProblem(null);

      let accepted = false;
      let ended = false;
      let settled = false;
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        options.onAccepted?.(value);
      };

      const handle = (message: SseMessage) => {
        const event = parseStreamEvent(message);
        if (!event) return;
        accepted = true;
        setReconnecting(false);
        settle(true);
        if (isEnd(event)) ended = true;
        dispatch({ type: 'event', event });
        // Der Titel entsteht mit der ersten Nachricht auf dem Server; gleich übernehmen, nicht erst am Ende.
        if (event.type === 'start' && event.userMessage) void refreshMeta();
      };

      const reattach: Starter = (onMessage, signal) => api.attachChat(chatId, onMessage, signal);
      let current = starter;
      try {
        for (let attempt = 0; ; attempt += 1) {
          try {
            const result = await current(handle, ac.signal);
            if (runId.current !== id) return;
            if (ended) break;
            if (result === 'empty') {
              // Nichts läuft mehr: die Antwort wurde in der Zwischenzeit fertig oder abgebrochen.
              await loadDetail();
              break;
            }
          } catch (error) {
            if (runId.current !== id || isAbort(error)) return;
            if (!(error instanceof ApiError) || error.code !== 'network') {
              setProblem(error instanceof ApiError ? error.code : 'unknown');
              if (!accepted) await loadDetail();
              break;
            }
            if (!accepted && options.changes && current === starter) {
              // Die Anfrage kam nicht an oder ihre Antwort ging verloren: der Server weiß mehr.
              setProblem('network');
              await loadDetail();
              break;
            }
          }

          if (attempt >= REATTACH_DELAYS_MS.length) {
            setProblem('network');
            await loadDetail();
            break;
          }
          setReconnecting(true);
          await pause(REATTACH_DELAYS_MS[attempt] ?? 3000, ac.signal);
          if (runId.current !== id) return;
          current = reattach;
        }
      } finally {
        if (runId.current === id) {
          controller.current = null;
          setRunning(false);
          setReconnecting(false);
          setStopping(false);
        }
        settle(false);
      }
      if (ended) void refreshMeta();
    },
    [api, chatId, loadDetail, refreshMeta],
  );

  const attach = useCallback(
    () => run((onMessage, signal) => api.attachChat(chatId, onMessage, signal)),
    [api, chatId, run],
  );

  // Beim Öffnen laden und sich an eine laufende Antwort anhängen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: nur bei einem anderen Chat neu starten
  useEffect(() => {
    let cancelled = false;
    api
      .chat(chatId)
      .then((detail) => {
        if (cancelled) return;
        dispatch({ type: 'loaded', detail });
        if (detail.generating) void attach();
      })
      .catch((error) => {
        if (cancelled) return;
        dispatch({
          type: 'load-failed',
          notFound:
            error instanceof ApiError && (error.code === 'not_found' || error.status === 404),
        });
      });
    return () => {
      cancelled = true;
      runId.current += 1;
      controller.current?.abort();
      controller.current = null;
    };
  }, [api, chatId]);

  // Kommt die Seite zurück (iPad aufgeweckt, Tab wieder offen), ist der Strom meist tot: neu anhängen.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (controller.current || generating.current) void attach();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [attach]);

  const send = useCallback(
    (content: string): Promise<boolean> =>
      new Promise((resolve) => {
        void run((onMessage, signal) => api.sendMessage(chatId, content, onMessage, signal), {
          changes: true,
          onAccepted: resolve,
        });
      }),
    [api, chatId, run],
  );

  const retry = useCallback(
    (viaApi = false) =>
      run((onMessage, signal) => api.retryChat(chatId, onMessage, signal, { viaApi }), {
        changes: true,
      }),
    [api, chatId, run],
  );

  const stop = useCallback(async (): Promise<void> => {
    setStopping(true);
    try {
      await api.stopChat(chatId);
    } catch {
      // Der Stopp ist nicht beim Server angekommen: das sichtbar melden, statt den Knopf still freizugeben.
      setStopping(false);
      setProblem('stop_failed');
      return;
    }
    setProblem(null);
    // Ohne offene Verbindung kommt das Ende nicht als Ereignis an: dann den Stand holen.
    if (!controller.current) {
      await loadDetail();
      setStopping(false);
    }
  }, [api, chatId, loadDetail]);

  return {
    state,
    dispatch,
    running,
    reconnecting,
    stopping,
    problem,
    dismissProblem,
    send,
    retry,
    stop,
    reconnect: attach,
    reload: loadDetail,
  };
}
