import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachImages, buildHistory, IMAGE_WIRE_MAX_BYTES } from '../chats/history';
import { createHarness, type Harness } from '../test-harness';
import { imageSignatureMatches, MAX_ATTACHMENTS, SNIFF_BYTES } from './assets';

/** Ein kleines echtes PNG (1×1 Pixel, grün) — die Signatur „‰PNG“ stimmt. */
const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

/** Kein Bild: der Text „Beispiel“ trägt keine Bildsignatur. */
const NOT_AN_IMAGE = Uint8Array.from(Buffer.from('Beispiel'));

describe('imageSignatureMatches', () => {
  it('erkennt PNG, JPEG, GIF und WebP an ihren Signaturen', () => {
    expect(imageSignatureMatches(PNG_BYTES.slice(0, SNIFF_BYTES), 'png')).toBe(true);
    expect(imageSignatureMatches(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), 'jpg')).toBe(true);
    expect(imageSignatureMatches(Uint8Array.from(Buffer.from('GIF89a……,')), 'gif')).toBe(true);
    expect(
      imageSignatureMatches(
        Uint8Array.from(Buffer.from('RIFF\u0010\u0000\u0000\u0000WEBP')),
        'webp',
      ),
    ).toBe(true);
  });

  it('lehnt Behauptungen ohne passende Signatur ab und fremde Endungen immer', () => {
    expect(imageSignatureMatches(NOT_AN_IMAGE.slice(0, SNIFF_BYTES), 'png')).toBe(false);
    expect(imageSignatureMatches(NOT_AN_IMAGE.slice(0, SNIFF_BYTES), 'jpg')).toBe(false);
    expect(imageSignatureMatches(NOT_AN_IMAGE.slice(0, SNIFF_BYTES), 'gif')).toBe(false);
    expect(imageSignatureMatches(NOT_AN_IMAGE.slice(0, SNIFF_BYTES), 'webp')).toBe(false);
    // Nicht-Bild-Endungen (PDF, Text) werden nicht per Signatur geprüft.
    expect(imageSignatureMatches(NOT_AN_IMAGE.slice(0, SNIFF_BYTES), 'pdf')).toBe(false);
  });
});

describe('Chat-Import: buildHistory mit Bildern', () => {
  it('hängt Bilder als Daten-URL an die letzte Nutzer-Nachricht und nennt die Namen im Text', () => {
    const history = buildHistory([
      { role: 'user', content: 'Was ist auf dem Bild?', status: 'complete' },
      { role: 'assistant', content: 'Ein Beispiel.', status: 'complete' },
      { role: 'user', content: 'Und hier noch eins.', status: 'complete' },
    ]);
    attachImages(history, [{ name: 'bild.png', mime: 'image/png', data: PNG_BYTES }]);
    const last = history[history.length - 1];
    expect(Array.isArray(last?.content)).toBe(true);
    const parts = last?.content as Array<{ type: string; text?: string }>;
    expect(parts[0]?.type).toBe('text');
    expect(parts[0]?.text).toContain('Und hier noch eins.');
    expect(parts[0]?.text).toContain('- bild.png');
    expect(parts.some((part) => part.type === 'image_url')).toBe(true);
    // Die ältere Nutzer-Nachricht bleibt Text.
    expect(history[0]?.content).toBe('Was ist auf dem Bild?');
  });

  it('ohne Bilder bleibt alles Text; zu große Bilder werden nur als Name genannt', () => {
    const turns = [{ role: 'user' as const, content: 'Siehe Anhang', status: 'complete' }];
    const plain = buildHistory(turns);
    expect(typeof plain[0]?.content).toBe('string');
    const history = buildHistory(turns);
    attachImages(history, [
      { name: 'riesig.png', mime: 'image/png', data: new Uint8Array(IMAGE_WIRE_MAX_BYTES + 1) },
    ]);
    const parts = history[0]?.content as Array<{ type: string; text?: string }>;
    expect(parts.some((part) => part.type === 'image_url')).toBe(false);
    expect(parts[0]?.text).toContain('- riesig.png');
  });
});

describe('Chat-Import: API', () => {
  let harness: Harness;
  let session: Awaited<ReturnType<Harness['signIn']>>;
  let chatId: string;
  let providerId: string;

  beforeEach(async () => {
    harness = createHarness();
    session = await harness.signIn();
    const subject = (await session.call('POST', '/api/subjects', { name: 'Beispielfach A' })).body
      .id as string;
    chatId = (await session.call('POST', '/api/chats', { subjectId: subject })).body.id as string;
    // Ein Fake-Anbieter, damit der Lauf startet; die Antwort des Modells bleibt im Test-Strom leer genug.
    const created = await session.call('POST', '/api/providers', {
      name: 'Beispiel-Anbieter',
      baseUrl: 'https://beispiel.anbieter.example/v1',
      apiKey: 'beispiel-schluessel-abcdefghijklmnop',
      models: [{ id: 'beispiel-modell' }],
    });
    providerId = created.body.id as string;
    await session.call('PUT', '/api/model-settings', {
      default: { providerId, model: 'beispiel-modell' },
      fallback: [],
    });
  });

  afterEach(() => {
    harness.close();
  });

  const multipart = (content: string, files: Array<{ name: string; body: Buffer | string }>) => {
    const boundary = `----pagewise${Date.now()}`;
    const chunks: Uint8Array[] = [];
    const part = (name: string, value: string | Buffer, filename?: string, type?: string) => {
      const head =
        `--${boundary}\r\n` +
        (filename
          ? `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type ?? 'application/octet-stream'}\r\n\r\n`
          : `Content-Disposition: form-data; name="${name}"\r\n\r\n`);
      chunks.push(Buffer.from(head), Buffer.from(value as Buffer), Buffer.from('\r\n'));
    };
    part('content', content);
    for (const file of files) part('files', file.body, file.name, 'image/png');
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return {
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      rawBody: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
    };
  };

  /** Formular-Post über den rohen Harness-Aufruf (Session-Kopfzeilen von Hand). */
  const postForm = (path: string, form: ReturnType<typeof multipart>) =>
    harness.call('POST', path, { ...form, cookie: session.cookie, csrf: session.csrf });

  it('nimmt ein Bild als Formular an, legt es an die Nachricht und zeigt es im Chat-Detail', async () => {
    const reply = await postForm(
      `/api/chats/${chatId}/messages`,
      multipart('Was ist auf dem Bild?', [{ name: 'beispiel.png', body: Buffer.from(PNG_BYTES) }]),
    );
    expect(reply.status).toBe(200);
    // Kurz warten, bis der Lauf den Import abgeschlossen hat (preparing vor dem Modellaufruf).
    await vi.waitFor(() => {
      const detail = harness.services.chats;
      expect(detail.running(chatId)).toBeNull();
    });

    const detail = await session.call('GET', `/api/chats/${chatId}`);
    const messages = detail.body.messages as
      | Array<{ role: string; content: string; assets: unknown[] }>
      | undefined;
    const user = messages?.find((message) => message.role === 'user');
    expect(user?.content).toBe('Was ist auf dem Bild?');
    expect(user?.assets).toHaveLength(1);
    expect(user?.assets[0]).toMatchObject({
      name: 'beispiel.png',
      kind: 'image',
      mime: 'image/png',
      size: PNG_BYTES.length,
    });
    // Das Bild ist als Datei da und hat die Original-Bytes (Bytes vergleicht der Dienst, nicht der Text).
    const first = user?.assets[0] as { id: string } | undefined;
    const stored = await harness.services.assets.read(first?.id ?? '');
    expect(Buffer.from(stored ?? [])).toEqual(Buffer.from(PNG_BYTES));
  });

  it('weist ein Bild ohne passende Signatur ab und behält trotzdem die Nachricht', async () => {
    const reply = await postForm(
      `/api/chats/${chatId}/messages`,
      multipart('Schau mal', [{ name: 'falsch.png', body: Buffer.from('Beispiel') }]),
    );
    expect(reply.status).toBe(200);
    await vi.waitFor(() => expect(harness.services.chats.running(chatId)).toBeNull());
    const detail = await session.call('GET', `/api/chats/${chatId}`);
    const messages = detail.body.messages as
      | Array<{ role: string; content: string; assets: unknown[] }>
      | undefined;
    const user = messages?.find((message) => message.role === 'user');
    expect(user?.content).toBe('Schau mal');
    expect(user?.assets).toHaveLength(0);
  });

  it('lehnt unbekannte Endungen ab und akzeptiert weiterhin Text und Dokumente', async () => {
    const reply = await postForm(
      `/api/chats/${chatId}/messages`,
      multipart('Zwei Dateien', [
        { name: 'boese.exe', body: Buffer.from('MZ') },
        { name: 'notizen.md', body: Buffer.from('# Notizen') },
      ]),
    );
    expect(reply.status).toBe(200);
    await vi.waitFor(() => expect(harness.services.chats.running(chatId)).toBeNull());
    const detail = await session.call('GET', `/api/chats/${chatId}`);
    const messages = detail.body.messages as
      | Array<{ role: string; content: string; assets: unknown[] }>
      | undefined;
    const user = messages?.find((message) => message.role === 'user');
    expect(user?.assets).toHaveLength(1);
    expect(user?.assets[0]).toMatchObject({ name: 'notizen.md', kind: 'text' });
  });

  it('ohne Text und mit Formular abgelehnt; zu viele Dateien werden auf die Grenze gekürzt', async () => {
    const empty = await postForm(
      `/api/chats/${chatId}/messages`,
      multipart('   ', [{ name: 'a.txt', body: 'x' }]),
    );
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('invalid_input');

    const files = Array.from({ length: MAX_ATTACHMENTS + 2 }, (_, index) => ({
      name: `datei-${index}.txt`,
      body: `Inhalt ${index}`,
    }));
    const many = await postForm(`/api/chats/${chatId}/messages`, multipart('Viele', files));
    expect(many.status).toBe(200);
    await vi.waitFor(() => expect(harness.services.chats.running(chatId)).toBeNull());
    const detail = await session.call('GET', `/api/chats/${chatId}`);
    const messages = detail.body.messages as
      | Array<{ role: string; content: string; assets: unknown[] }>
      | undefined;
    const user = messages?.find((message) => message.role === 'user');
    expect(user?.assets).toHaveLength(MAX_ATTACHMENTS);
  });

  it('kopiert beigelegte Dateien in den Arbeitsordner des Agenten-Fachs', async () => {
    const subject = (await session.call('POST', '/api/subjects', { name: 'Beispielfach B' })).body
      .id as string;
    const another = (await session.call('POST', '/api/chats', { subjectId: subject })).body
      .id as string;
    const reply = await postForm(
      `/api/chats/${another}/messages`,
      multipart('Lies die Datei', [{ name: 'aufgabe.md', body: Buffer.from('# Aufgabe') }]),
    );
    expect(reply.status).toBe(200);
    await vi.waitFor(() => expect(harness.services.chats.running(another)).toBeNull());
    // Der Arbeitsordner liegt im Datenverzeichnis des Tests unter workspaces/<fach>/imports/<fach>.
    const root = harness.services.paths.root;
    const found = join(root, 'workspaces', subject, 'imports', subject, 'aufgabe.md');
    expect(existsSync(found)).toBe(true);
    expect(readFileSync(found, 'utf8')).toBe('# Aufgabe');
  });

  it('JSON ohne Dateien läuft wie bisher', async () => {
    const reply = await session.call('POST', `/api/chats/${chatId}/messages`, {
      content: 'Klassische Frage',
    });
    expect(reply.status).toBe(200);
    await vi.waitFor(() => expect(harness.services.chats.running(chatId)).toBeNull());
    const detail = await session.call('GET', `/api/chats/${chatId}`);
    const messages = detail.body.messages as
      | Array<{ role: string; content: string; assets: unknown[] }>
      | undefined;
    const user = messages?.find((message) => message.role === 'user');
    expect(user?.content).toBe('Klassische Frage');
    expect(user?.assets).toHaveLength(0);
  });
});
