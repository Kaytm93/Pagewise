import { AlertTriangle, FileQuestion, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ChatPreview } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { useSession } from '../../session/SessionProvider';
import { Button } from '../../ui/Button';

type Load =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'failed'; code: string }
  | { state: 'ready'; preview: ChatPreview };

/** Seitenzahl-Wahl der Vorschau: wie im Server-Vertrag (1..3, Voreinstellung 3). */
const PAGE_CHOICES = [1, 2, 3] as const;

/**
 * Live-Vorschau im Datei-Panel (D-106, H-C03): rendert die ersten Seiten einer Datei des
 * Chat-Arbeitsordners über `GET /api/chats/:id/preview` und zeigt sie als gewöhnliche
 * Bild-Elemente mit vom Server geprüften Daten-Adressen — genau der bestehende, CSP-konforme
 * Weg (`img-src 'self' data:`, wie in AssetList). Kein Inline-Stil, alle Texte aus
 * `i18n/de.ts`, die Seitenwahl ist eine 44-px-Liste. Ohne gewählte Datei: Hinweis. Fehlt die
 * Freigabe oder scheitert das Rendern: „Vorschau nicht möglich“ mit dem festen Code des
 * Servers und „Erneut versuchen“.
 */
export function FilePreview({ chatId, file }: { chatId: string; file: string | null }) {
  const { api } = useSession();
  const [pages, setPages] = useState<number>(3);
  const [load, setLoad] = useState<Load>({ state: 'idle' });
  const [reloadKey, setReloadKey] = useState(0);

  // Andere Datei gewählt: der Ladeeffekt unten beginnt von vorn (Schlüssel zählt mit).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey löst gezielt eine neue Ladung aus
  useEffect(() => {
    if (file === null) {
      setLoad({ state: 'idle' });
      return;
    }
    let cancelled = false;
    setLoad({ state: 'loading' });
    api
      .chatPreview(chatId, file, pages)
      .then((preview) => {
        if (!cancelled) setLoad({ state: 'ready', preview });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const code =
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          typeof error.code === 'string'
            ? error.code
            : 'unknown';
        setLoad({ state: 'failed', code });
      });
    return () => {
      cancelled = true;
    };
  }, [api, chatId, file, pages, reloadKey]);

  if (file === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-3 py-3 text-center">
        <FileQuestion aria-hidden="true" className="size-6 text-ink-muted" />
        <p className="text-sm text-ink-secondary">{m.chat.files.previewNoFile}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3">
      <div className="flex items-center gap-2 pb-2">
        {/* Der volle Name steht im `title`, die Zeile kürzt am Ende. */}
        <span title={file} className="min-w-0 flex-1 truncate text-sm font-medium">
          {file}
        </span>
        <label htmlFor="chat-preview-pages" className="sr-only">
          {m.chat.files.previewPagesLabel}
        </label>
        <select
          id="chat-preview-pages"
          value={pages}
          onChange={(event) => setPages(Number(event.target.value))}
          className="min-h-11 rounded-control border border-control-edge bg-canvas px-2 text-sm text-ink"
        >
          {PAGE_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {format(m.chat.files.previewPagesChoice, { count: choice })}
            </option>
          ))}
        </select>
      </div>

      {load.state === 'loading' && (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-secondary">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          {m.chat.files.previewLoading}
        </p>
      )}

      {load.state === 'failed' && (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-danger">
            <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
            {m.chat.files.previewFailed}
          </p>
          <p className="text-meta text-ink-muted">
            {format(m.chat.files.previewFailedCode, { code: load.code })}
          </p>
          <Button variant="secondary" onClick={() => setReloadKey((key) => key + 1)}>
            {m.common.retry}
          </Button>
        </div>
      )}

      {load.state === 'ready' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {load.preview.pages.length === 0 ? (
            <p className="text-sm text-ink-secondary">{m.chat.files.previewFailed}</p>
          ) : (
            <ul className="space-y-3">
              {load.preview.pages.map((page) => (
                <li key={page.number}>
                  {/* Gewöhnliches Bild-Element wie in AssetList; die Daten-Adresse kommt
                      geprüft vom eigenen Server (Anmeldung, nosniff, strenge CSP). */}
                  <img
                    src={page.png}
                    alt={format(m.chat.files.previewPageAlt, { number: page.number })}
                    loading="lazy"
                    className="max-w-full rounded-control border border-line bg-paper"
                  />
                  <p className="mt-1 text-meta text-ink-muted">
                    {load.preview.pagesTotal !== null
                      ? format(m.chat.files.previewPageTotalLabel, {
                          number: page.number,
                          total: load.preview.pagesTotal,
                        })
                      : format(m.chat.files.previewPageLabel, { number: page.number })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
