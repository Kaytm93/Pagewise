import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type Session } from '../test-harness';
import { contentDisposition } from './assets';

describe('contentDisposition', () => {
  it('liefert einen ASCII-Rückfall und die UTF-8-Fassung', () => {
    expect(contentDisposition('Präsentation "Eins".pptx')).toBe(
      `attachment; filename="Pr_sentation _Eins_.pptx"; filename*=UTF-8''Pr%C3%A4sentation%20%22Eins%22.pptx`,
    );
  });
});

describe('Dateien herunterladen', () => {
  let harness: Harness;
  let session: Session;
  let work: string;
  let assetId: string;
  beforeEach(async () => {
    harness = createHarness();
    session = await harness.signIn();
    work = mkdtempSync(join(tmpdir(), 'pagewise-work-'));
    const subject = harness.services.database.sqlite
      .prepare("select id from subjects where kind = 'default'")
      .get() as { id: string };
    const chat = (await session.call('POST', '/api/chats', { subjectId: subject.id })).body as {
      id: string;
    };
    const messageId = '33333333-3333-4333-8333-333333333333';
    harness.services.database.sqlite
      .prepare(
        "insert into messages (id, chat_id, seq, role, content, status, created_at, updated_at) values (?, ?, 1, 'assistant', '', 'complete', 0, 0)",
      )
      .run(messageId, chat.id);
    writeFileSync(join(work, 'Bericht Ä.pdf'), 'PDF-INHALT');
    const [asset] = await harness.services.assets.takeover(work, new Map(), {
      chatId: chat.id,
      messageId,
    });
    assetId = asset?.id ?? '';
  });
  afterEach(() => {
    harness.close();
    rmSync(work, { recursive: true, force: true });
  });

  it('liefert die Datei nur als Download mit festem Typ und ohne Ausführung', async () => {
    const reply = await session.call('GET', `/api/assets/${assetId}/download`);
    expect(reply.status).toBe(200);
    expect(reply.text).toBe('PDF-INHALT');
    expect(reply.headers.get('content-type')).toBe('application/pdf');
    expect(reply.headers.get('content-disposition')).toMatch(
      /^attachment; filename="B[^"]*richt _\.pdf"; filename\*=UTF-8''Bericht%20%C3%84\.pdf$/,
    );
    expect(reply.headers.get('x-content-type-options')).toBe('nosniff');
    expect(reply.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(reply.headers.get('cache-control')).toBe('no-store');
  });

  it.each(['kein-uuid', '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b', '..%2F..%2Fgeheim'])(
    'liefert für %s nichts',
    async (id) => {
      expect((await session.call('GET', `/api/assets/${id}/download`)).status).toBe(404);
    },
  );

  it('liefert nichts mehr, wenn die Datei fehlt', async () => {
    await harness.services.storage.delete(assetId);
    expect((await session.call('GET', `/api/assets/${assetId}/download`)).status).toBe(404);
  });
});
