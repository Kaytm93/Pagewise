import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../test-harness';
import { MAX_ASSET_BYTES, MAX_ASSETS_PER_RUN, safeFileName, typeOf } from './assets';
import { snapshotDir } from './workspace';

describe('safeFileName', () => {
  it.each([
    ['bericht.pdf', 'bericht.pdf'],
    ['unter/ordner/Präsentation Neu.PPTX', 'Präsentation Neu.pptx'],
    ['../../etc/passwd.txt', 'passwd.txt'],
    ['.versteckt.pdf', 'versteckt.pdf'],
    ['a\u0000b\nc.txt', 'a_b_c.txt'],
    ['mit<>:"|?*zeichen.png', 'mit_______zeichen.png'],
    ['zwei..punkte...pdf', 'zwei.punkte.pdf'],
    ['', 'datei'],
    ['.pdf', 'pdf'],
    ['....', 'datei'],
  ])('macht aus %j den Namen %j', (input, expected) => {
    expect(safeFileName(input)).toBe(expected);
  });

  it('kürzt sehr lange Namen und behält die Endung', () => {
    const name = safeFileName(`${'x'.repeat(500)}.pdf`);
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});

describe('typeOf', () => {
  it('kennt PDF, Office-Dateien, Bilder und Texte und sonst nichts', () => {
    expect(typeOf('a.PDF')).toMatchObject({ kind: 'pdf', mime: 'application/pdf' });
    expect(typeOf('a.pptx')?.kind).toBe('pptx');
    expect(typeOf('a.png')?.kind).toBe('image');
    expect(typeOf('a.md')?.kind).toBe('text');
    for (const name of ['a.sh', 'a.exe', 'a.html', 'a.js', 'a', 'a.pdf.exe', 'a.zip']) {
      expect(typeOf(name)).toBeNull();
    }
  });
});

describe('AssetService', () => {
  let harness: Harness;
  let work: string;
  let chatId: string;
  let messageId: string;
  beforeEach(() => {
    harness = createHarness();
    work = mkdtempSync(join(tmpdir(), 'pagewise-work-'));
    const subject = harness.services.database.sqlite
      .prepare("select id from subjects where kind = 'default'")
      .get() as { id: string };
    const chat = harness.services.chats.create(subject.id, null);
    if (!chat.ok) throw new Error('Chat anlegen fehlgeschlagen');
    chatId = chat.value.id;
    messageId = '33333333-3333-4333-8333-333333333333';
    harness.services.database.sqlite
      .prepare(
        "insert into messages (id, chat_id, seq, role, content, status, created_at, updated_at) values (?, ?, 1, 'assistant', '', 'complete', 0, 0)",
      )
      .run(messageId, chatId);
  });
  afterEach(() => {
    harness.close();
    rmSync(work, { recursive: true, force: true });
  });

  const assets = () => harness.services.assets;
  const takeover = (before = new Map()) => assets().takeover(work, before, { chatId, messageId });

  it('übernimmt neue und geänderte Dateien mit erlaubter Endung als Assets', async () => {
    writeFileSync(join(work, 'alt.pdf'), 'alt');
    const before = snapshotDir(work);
    writeFileSync(join(work, 'alt.pdf'), 'alt und geändert');
    writeFileSync(join(work, 'folien.pptx'), 'PPTX-Inhalt');
    mkdirSync(join(work, 'unter'));
    writeFileSync(join(work, 'unter', 'Bild Eins.png'), 'PNG');
    const taken = await takeover(before);
    expect(taken.map((a) => [a.name, a.kind])).toEqual([
      ['alt.pdf', 'pdf'],
      ['folien.pptx', 'pptx'],
      ['Bild Eins.png', 'image'],
    ]);
    const first = taken[0];
    expect(first?.size).toBe(Buffer.byteLength('alt und geändert'));
    expect(Buffer.from((await assets().read(first?.id ?? '')) ?? []).toString()).toBe(
      'alt und geändert',
    );
    expect(assets().forMessages([messageId]).get(messageId)).toHaveLength(3);
  });

  it('lässt unbekannte Endungen, versteckte Dateien, Verknüpfungen und zu große Dateien aus', async () => {
    writeFileSync(join(work, 'skript.sh'), 'rm -rf');
    writeFileSync(join(work, 'seite.html'), '<script>');
    writeFileSync(join(work, '.geheim.pdf'), 'x');
    writeFileSync(join(work, 'riesig.pdf'), Buffer.alloc(MAX_ASSET_BYTES + 1));
    const outside = join(tmpdir(), `pagewise-aussen-${Date.now()}.pdf`);
    writeFileSync(outside, 'darf nicht in die Assets');
    symlinkSync(outside, join(work, 'link.pdf'));
    writeFileSync(join(work, 'gut.pdf'), 'gut');
    try {
      const taken = await takeover();
      expect(taken.map((a) => a.name)).toEqual(['gut.pdf']);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it('übernimmt höchstens so viele Dateien wie erlaubt', async () => {
    for (let i = 0; i < MAX_ASSETS_PER_RUN + 5; i += 1) {
      writeFileSync(join(work, `datei-${String(i).padStart(2, '0')}.txt`), 'x');
    }
    expect(await takeover()).toHaveLength(MAX_ASSETS_PER_RUN);
  });

  it('legt die Dateien im Datenverzeichnis ab und räumt sie mit Chat und Fach auf', async () => {
    writeFileSync(join(work, 'a.pdf'), 'A');
    writeFileSync(join(work, 'b.pdf'), 'B');
    const taken = await takeover();
    const ids = taken.map((a) => a.id);
    for (const id of ids) expect(await harness.services.storage.exists(id)).toBe(true);
    expect(assets().idsForChat(chatId).sort()).toEqual([...ids].sort());
    const subject = harness.services.database.sqlite
      .prepare('select subject_id as s from chats where id = ?')
      .get(chatId) as { s: string };
    expect(assets().idsForSubject(subject.s).sort()).toEqual([...ids].sort());
    expect(assets().idsForSubject('44444444-4444-4444-8444-444444444444')).toEqual([]);

    await assets().deleteFiles(ids);
    for (const id of ids) expect(await harness.services.storage.exists(id)).toBe(false);
    // Doppeltes Löschen und unbekannte IDs sind harmlos.
    await assets().deleteFiles([...ids, 'unbekannt']);
  });

  it('lässt die Zeilen mit dem Chat verschwinden', async () => {
    writeFileSync(join(work, 'a.pdf'), 'A');
    await takeover();
    harness.services.chats.remove(chatId);
    const count = harness.services.database.sqlite
      .prepare('select count(*) as n from assets')
      .get() as { n: number };
    expect(count.n).toBe(0);
  });
});
