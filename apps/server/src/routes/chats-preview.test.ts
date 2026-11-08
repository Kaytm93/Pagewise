import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PreviewError } from '../preview/render';
import { createHarness, type Harness, type Session } from '../test-harness';

/*
 * H-C03 (D-106): Live-Vorschau im Datei-Panel. Der PreviewService ist hier immer eine Fälschung
 * (kein echtes soffice/poppler in Unit-Tests); geprüft werden die Route selbst: ihre eigenen
 * Sicherheitsprüfungen vor dem Rendern, die Seitenbegrenzung und die festen Fehlercodes. Alle
 * Inhalte sind erfunden; das PNG ist keine echte Bilddatei, nur ein erkennbarer Textpuffer.
 */

const PAGE = Buffer.from('SEITENBILD-ERFUNDEN-1');
const UNKNOWN_ID = '5b0f7c2e-4a54-4c0a-9b6a-0d4c6b1d2e3f';

interface PreviewCall {
  chatId: string;
  file: string;
  pages: number;
}

describe('GET /api/chats/:id/preview', () => {
  let harness: Harness;
  let session: Session;
  let subjectId: string;
  let calls: PreviewCall[];
  let previewError: PreviewError | null;

  beforeEach(async () => {
    calls = [];
    previewError = null;
    harness = createHarness();
    session = await harness.signIn();
    subjectId = (await session.call('POST', '/api/subjects', { name: 'Beispielfach A' })).body
      .id as string;
    // Die Fälschung rendert ohne Programme: genau so, wie es der echte Dienst nach seinen
    // eigenen Prüfungen täte; die Route bekommt nur das Ergebnis oder den Fehlercode.
    harness.services.preview.available = () => true;
    harness.services.preview.render = async (input) => {
      calls.push({ chatId: input.chatId, file: input.file, pages: input.pages });
      if (previewError) throw previewError;
      return {
        pagesTotal: 5,
        pages: [
          { number: 1, png: PAGE },
          { number: 2, png: Buffer.from('SEITENBILD-ERFUNDEN-2') },
        ],
      };
    };
  });

  afterEach(() => harness.close());

  const newChat = async (): Promise<string> => {
    const reply = await session.call('POST', '/api/chats', { subjectId, groupId: null });
    expect(reply.status).toBe(201);
    return reply.body.id as string;
  };

  const enable = async () => {
    await session.call('PUT', '/api/tool-settings', { code: true, confirm: true });
  };

  const preview = async (chatId: string, query = '?file=bericht.pdf') =>
    session.call('GET', `/api/chats/${chatId}/preview${query}`);

  it('rendert die ersten Seiten als Daten-Adressen, nur Metadaten und PNG, keine Dateiinhalte', async () => {
    const chatId = await newChat();
    await enable();
    const reply = await preview(chatId, '?file=bericht.pdf&pages=2');
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ file: 'bericht.pdf', pagesTotal: 5 });
    const pages = reply.body.pages as { number: number; png: string }[];
    expect(pages.map((page) => page.number)).toEqual([1, 2]);
    expect(pages[0]?.png).toBe(`data:image/png;base64,${PAGE.toString('base64')}`);
    // Der Aufruf landete beim Dienst mit derselben Chat-ID und der begrenzten Seitenzahl.
    expect(calls).toEqual([{ chatId, file: 'bericht.pdf', pages: 2 }]);
    // Cache-Header: nie zwischenspeichern.
    expect(reply.headers.get('cache-control')).toBe('no-store');
  });

  it('begrenzt pages auf 1..3 und nimmt ganze Zahlen', async () => {
    const chatId = await newChat();
    await enable();
    await preview(chatId, '?file=a.pdf&pages=99');
    await preview(chatId, '?file=a.pdf&pages=0');
    await preview(chatId, '?file=a.pdf&pages=2.7');
    await preview(chatId, '?file=a.pdf&pages=drei');
    await preview(chatId);
    expect(calls.map((call) => call.pages)).toEqual([3, 1, 2, 3, 3]);
  });

  it('verlangt die Freigabe „Code ausführen“: aus → 403, an → gerendert', async () => {
    const chatId = await newChat();
    // Voreinstellung: aus (D-079).
    expect((await preview(chatId)).status).toBe(403);
    expect((await preview(chatId)).body.error).toBe('forbidden');
    expect(calls).toEqual([]);
    await enable();
    expect((await preview(chatId)).status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it('antwortet 403, wenn die Werkzeuge fehlen (kein soffice/poppler/Sandbox)', async () => {
    const chatId = await newChat();
    await enable();
    harness.services.preview.available = () => false;
    const reply = await preview(chatId);
    expect(reply.status).toBe(403);
    expect(reply.body.error).toBe('forbidden');
    expect(calls).toEqual([]);
  });

  it('antwortet 404 für unbekannte oder ungültige Chat-IDs; ein frischer Aufbau ohne Programme bleibt 403', async () => {
    await enable();
    expect((await preview(UNKNOWN_ID)).status).toBe(404);
    expect((await preview('viel-laenger-als-eine-uuid')).status).toBe(404);
    expect((await preview('../../geheim')).status).toBe(404);
    // Ohne PreviewService (Tests ohne Sichtprüfung) bleibt der Weg zu.
    const withoutPreview = createHarness();
    const otherSession = await withoutPreview.signIn();
    const otherSubject = (
      await otherSession.call('POST', '/api/subjects', { name: 'Beispielfach B' })
    ).body.id as string;
    const otherChat = (await otherSession.call('POST', '/api/chats', { subjectId: otherSubject }))
      .body.id as string;
    await otherSession.call('PUT', '/api/tool-settings', { code: true, confirm: true });
    // Ohne PreviewService fehlt der ganze Weg; auch die Schalter sind dann nie erreichbar.
    harness.services.preview.available = () => false;
    expect(
      (await otherSession.call('GET', `/api/chats/${otherChat}/preview?file=a.pdf`)).status,
    ).toBe(403);
    expect(
      (await otherSession.call('GET', `/api/chats/${otherChat}/preview?file=.geheim.pdf`)).status,
    ).toBe(403);
    withoutPreview.close();
  });

  it('lehnt Pfade im file-Parameter fest ab (404), bevor irgendein Pfad entsteht', async () => {
    const chatId = await newChat();
    await enable();
    for (const file of ['../geheim.pdf', 'ordner/folien.pptx', 'C:\\tmp\\datei.pdf', 'a\\b.pdf']) {
      const reply = await preview(chatId, `?file=${encodeURIComponent(file)}`);
      expect(reply.status).toBe(404);
      expect(reply.body.error).toBe('not_found');
    }
    expect(calls).toEqual([]);
  });

  it('lehnt versteckte Namen fest ab (404), auch simple Punkte', async () => {
    const chatId = await newChat();
    await enable();
    for (const file of ['.geheim.pdf', '.run.pdf', '.home', '.', '..']) {
      const reply = await preview(chatId, `?file=${encodeURIComponent(file)}`);
      expect(reply.status).toBe(404);
    }
    expect(calls).toEqual([]);
  });

  it('reicht die festen Codes des Dienstes in den richtigen Status weiter', async () => {
    const chatId = await newChat();
    await enable();
    // Fehlende Datei im Arbeitsordner → 404.
    previewError = new PreviewError('not_found');
    let reply = await preview(chatId);
    expect(reply.status).toBe(404);
    expect(reply.body.error).toBe('not_found');
    // Werkzeug während des Laufs verschwunden → 409.
    previewError = new PreviewError('unavailable');
    reply = await preview(chatId);
    expect(reply.status).toBe(409);
    expect(reply.body.error).toBe('unavailable');
    // Sonstiges Scheitern des Renderns → 502, nur Code, nie Inhalt.
    previewError = new PreviewError('convert_failed');
    reply = await preview(chatId);
    expect(reply.status).toBe(502);
    expect(reply.body.error).toBe('convert_failed');
    expect(JSON.stringify(reply.body)).not.toContain('SEITENBILD');
  });

  it('liefert Arbeitsordner-Dateien mit Anmeldung und nichts ohne', async () => {
    const chatId = await newChat();
    await enable();
    expect((await harness.call('GET', `/api/chats/${chatId}/preview?file=a.pdf`)).status).toBe(401);
    expect((await preview(chatId)).status).toBe(200);
  });

  it('bleibt bei Fehlern des Dienstes ohne Spur in der Antwort: nur der feste Code', async () => {
    const chatId = await newChat();
    await enable();
    const dir = harness.services.workspaces.ensure(chatId, null);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bericht.pdf'), 'Beispielinhalt');
    // Die Fälschung wirft: die Route darf den Arbeitsordner nicht verändern und nichts
    // aus der Datei in die Antwort nehmen (den Temp-Ordner räumt der echte Dienst selbst weg).
    previewError = new PreviewError('not_found');
    const reply = await preview(chatId);
    expect(reply.status).toBe(404);
    expect(reply.text).toBe(JSON.stringify({ error: 'not_found' }));
    expect(reply.text).not.toContain('Beispielinhalt');
  });
});
