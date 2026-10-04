import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../test-harness';
import { secretNameFor } from './profiles';

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const TOKEN = ['beispiel', 'token', 'abcdefghijklmnop'].join('-');

describe('EngineProfileService', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = createHarness();
  });
  afterEach(() => harness.close());
  const engines = () => harness.services.engines;
  const secrets = () => harness.services.secrets;

  it('legt ein Abo-Profil ohne Schlüssel an und lehnt einen Schlüssel dafür ab', async () => {
    const created = await engines().create({ kind: 'claude-subscription', name: 'Mein Abo' });
    expect(created).toMatchObject({
      ok: true,
      value: { kind: 'claude-subscription', name: 'Mein Abo', hasToken: false, timeoutMinutes: 20 },
    });
    expect(
      await engines().create({ kind: 'claude-subscription', name: 'Anderes', token: TOKEN }),
    ).toEqual({
      ok: false,
      error: 'token_not_allowed',
    });
    expect(await secrets().list()).toEqual([]);
  });

  it.each(['glm-coding-plan', 'anthropic-api'] as const)(
    'verlangt für %s einen Schlüssel',
    async (kind) => {
      expect(await engines().create({ kind, name: 'Ohne' })).toEqual({
        ok: false,
        error: 'token_required',
      });
      expect(await engines().create({ kind, name: 'Leer', token: '   ' })).toEqual({
        ok: false,
        error: 'token_required',
      });
      expect(await engines().list()).toEqual([]);
    },
  );

  it('speichert den Schlüssel nur im Secret-Speicher und gibt ihn nie heraus', async () => {
    const created = await engines().create({ kind: 'glm-coding-plan', name: 'GLM', token: TOKEN });
    if (!created.ok) throw new Error('Anlegen fehlgeschlagen');
    const { id } = created.value;
    expect(created.value).toMatchObject({ hasToken: true, tokenHint: TOKEN.slice(-4) });
    expect(JSON.stringify(created.value)).not.toContain(TOKEN);
    expect(JSON.stringify(await engines().list())).not.toContain(TOKEN);
    expect(await secrets().get(secretNameFor(id))).toBe(TOKEN);
    // Auch nicht in der Datenbank.
    const rows = harness.services.database.sqlite.prepare('select * from engine_profiles').all();
    expect(JSON.stringify(rows)).not.toContain(TOKEN);
    expect(await engines().resolve(id)).toMatchObject({ token: TOKEN, profile: { id } });
  });

  it('hält Namen ohne Beachtung von Groß- und Kleinschreibung eindeutig', async () => {
    await engines().create({ kind: 'claude-subscription', name: 'Mein Abo' });
    expect(await engines().create({ kind: 'claude-subscription', name: 'MEIN ABO' })).toEqual({
      ok: false,
      error: 'name_taken',
    });
    const other = await engines().create({ kind: 'claude-subscription', name: 'Zweites' });
    if (!other.ok) throw new Error('Anlegen fehlgeschlagen');
    expect(await engines().update(other.value.id, { name: 'mein abo' })).toEqual({
      ok: false,
      error: 'name_taken',
    });
    // Die eigene Schreibweise darf sich ändern.
    expect(await engines().update(other.value.id, { name: 'ZWEITES' })).toMatchObject({ ok: true });
  });

  it('ändert Angaben und ersetzt den Schlüssel, ohne ihn zu zeigen', async () => {
    const created = await engines().create({ kind: 'anthropic-api', name: 'API', token: TOKEN });
    if (!created.ok) throw new Error('Anlegen fehlgeschlagen');
    const next = ['neuer', 'token', 'wert', 'zzzzzzzzzz'].join('-');
    const updated = await engines().update(created.value.id, {
      model: 'claude-beispiel',
      timeoutMinutes: 45,
      token: next,
    });
    expect(updated).toMatchObject({
      ok: true,
      value: { model: 'claude-beispiel', timeoutMinutes: 45, tokenHint: next.slice(-4) },
    });
    expect(await secrets().get(secretNameFor(created.value.id))).toBe(next);
    expect(JSON.stringify(updated)).not.toContain(next);
  });

  it('lässt sich einen Schlüssel nicht löschen, ohne den Zugang zu löschen', async () => {
    const created = await engines().create({ kind: 'glm-coding-plan', name: 'GLM', token: TOKEN });
    if (!created.ok) throw new Error('Anlegen fehlgeschlagen');
    expect(await engines().update(created.value.id, { clearToken: true })).toEqual({
      ok: false,
      error: 'token_required',
    });
  });

  it('löscht den Zugang samt Schlüssel', async () => {
    const created = await engines().create({ kind: 'glm-coding-plan', name: 'GLM', token: TOKEN });
    if (!created.ok) throw new Error('Anlegen fehlgeschlagen');
    expect(await engines().remove(created.value.id)).toEqual({ ok: true, value: null });
    expect(await secrets().list()).toEqual([]);
    expect(await engines().list()).toEqual([]);
    expect(await engines().remove(created.value.id)).toEqual({ ok: false, error: 'not_found' });
  });

  it('begrenzt die Zahl der Zugänge und behält die Reihenfolge', async () => {
    for (let i = 0; i < 20; i += 1) {
      const result = await engines().create({ kind: 'claude-subscription', name: `Zugang ${i}` });
      expect(result.ok).toBe(true);
    }
    expect(await engines().create({ kind: 'claude-subscription', name: 'Einer zu viel' })).toEqual({
      ok: false,
      error: 'too_many',
    });
    const list = await engines().list();
    expect(list.map((entry) => entry.name).slice(0, 3)).toEqual([
      'Zugang 0',
      'Zugang 1',
      'Zugang 2',
    ]);
  });

  it('lässt Fächer und Chats auf ihr Modell zurückfallen, wenn der Zugang verschwindet', async () => {
    const created = await engines().create({ kind: 'claude-subscription', name: 'Abo' });
    if (!created.ok) throw new Error('Anlegen fehlgeschlagen');
    const { sqlite } = harness.services.database;
    sqlite
      .prepare(
        "insert into subjects (id, name, engine_profile_id, created_at, updated_at) values ('11111111-1111-4111-8111-111111111111', 'Beispielfach', ?, 0, 0)",
      )
      .run(created.value.id);
    await engines().remove(created.value.id);
    expect(
      sqlite
        .prepare("select engine_profile_id as e from subjects where name = 'Beispielfach'")
        .get(),
    ).toEqual({ e: null });
  });
});
