// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError } from '../../api/client';
import { SessionProvider } from '../../session/SessionProvider';
import { FilePreview } from './FilePreview';

/*
 * H-C03 (D-106): Live-Vorschau im Datei-Panel. Die Komponente ruft nur die Route
 * `GET /api/chats/:id/preview` auf und zeigt die gerenderten Seiten als gewöhnliche
 * Bild-Elemente mit Daten-Adressen vom Server (CSP-konform, wie in AssetList).
 * Lade-, Fehler- und Fallback-Zustand bleiben sauber; alle Namen sind erfunden.
 */

const PREVIEW = {
  file: 'bericht.pdf',
  pagesTotal: 5,
  pages: [
    { number: 1, png: 'data:image/png;base64,SEITE1' },
    { number: 2, png: 'data:image/png;base64,SEITE2' },
  ],
};

interface PreviewCall {
  file: string;
  pages: number;
}

/** Sitzungs-Ersatz, der die Vorschau-Anfragen aufzeichnet und beantwortet. */
function mountWith(
  preview: (call: { file: string; pages: number }) => Promise<Response>,
  props: { chatId?: string; file: string | null } = { file: 'bericht.pdf' },
): PreviewCall[] {
  const calls: PreviewCall[] = [];
  const client = new ApiClient({
    fetch: (async (input: Parameters<typeof fetch>[0]) => {
      const path = String(input);
      const match = /\/api\/chats\/[^/]+\/preview\?file=([^&]*)&pages=(\d+)/.exec(path);
      if (!match) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      const call = { file: decodeURIComponent(match[1] ?? ''), pages: Number(match[2]) };
      calls.push(call);
      try {
        return await preview(call);
      } catch (error) {
        const code = error instanceof ApiError ? error.code : 'unknown';
        const status = error instanceof ApiError ? error.status : 500;
        return new Response(JSON.stringify({ error: code }), { status });
      }
    }) as typeof fetch,
  });
  render(
    <SessionProvider client={client}>
      <FilePreview chatId={props.chatId ?? 'chat-1'} file={props.file} />
    </SessionProvider>,
  );
  return calls;
}

describe('FilePreview (H-C03)', () => {
  it('zeigt ohne gewählte Datei nur den Hinweis und ruft nichts ab', () => {
    const calls = mountWith(() => Promise.resolve(new Response('{}')), { file: null });
    expect(
      screen.getByText('Wähle oben im Reiter „Dateien“ eine Datei aus, um sie hier zu sehen.'),
    ).toBeTruthy();
    expect(calls).toEqual([]);
    expect(document.querySelector('[style]')).toBeNull();
  });

  it('lädt die Vorschau und zeigt die Seiten als Bild-Elemente mit Daten-Adressen', async () => {
    const calls = mountWith(() => Promise.resolve(new Response(JSON.stringify(PREVIEW))));
    expect(screen.getByRole('status').textContent).toContain('Vorschau wird gerendert');
    expect(await screen.findByAltText('Vorschau der Seite 1')).toBeTruthy();
    const bilder = screen.getAllByRole('img') as HTMLImageElement[];
    expect(bilder.map((bild) => bild.getAttribute('src'))).toEqual([
      'data:image/png;base64,SEITE1',
      'data:image/png;base64,SEITE2',
    ]);
    // Seitenzahl und Gesamtzahl stehen zusammen in einer Zeile (nur das <p>, nicht das <li>).
    expect(
      screen.getByText(
        (_, element) => element?.tagName === 'P' && element.textContent === 'Seite 1 von 5',
      ),
    ).toBeTruthy();
    expect(calls).toEqual([{ file: 'bericht.pdf', pages: 3 }]);
    // CSP: kein Inline-Stil im Markup.
    expect(document.querySelector('[style]')).toBeNull();
  });

  it('wählt die Seitenzahl neu und lädt dann mit der gewählten Zahl', async () => {
    const calls = mountWith(() => Promise.resolve(new Response(JSON.stringify(PREVIEW))));
    await screen.findByAltText('Vorschau der Seite 1');
    fireEvent.change(screen.getByLabelText('Seiten der Vorschau'), { target: { value: '1' } });
    await waitFor(() =>
      expect(calls).toEqual([
        { file: 'bericht.pdf', pages: 3 },
        { file: 'bericht.pdf', pages: 1 },
      ]),
    );
  });

  it('zeigt „Vorschau nicht möglich“ mit dem festen Code und lädt auf Knopfdruck neu', async () => {
    const antwort = () => Promise.reject(new ApiError('forbidden', 403));
    const calls = mountWith(antwort);
    expect(await screen.findByText('Vorschau nicht möglich.')).toBeTruthy();
    expect(
      screen.getByText(
        (_, element) => element?.tagName === 'P' && element.textContent === 'Grund: forbidden',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeTruthy();
    // Kein Bild im Fehlerzustand; die Anfrage selbst fand statt und scheiterte mit dem Code.
    expect(screen.queryByRole('img')).toBeNull();
    expect(calls).toEqual([{ file: 'bericht.pdf', pages: 3 }]);
    expect(document.querySelector('[style]')).toBeNull();
  });

  it('kürzt den Dateinamen nicht im title-Attribut und trägt ihn sichtbar', async () => {
    mountWith(() => Promise.resolve(new Response(JSON.stringify(PREVIEW))));
    await screen.findByAltText('Vorschau der Seite 1');
    expect(screen.getByTitle('bericht.pdf').textContent).toBe('bericht.pdf');
  });
});
