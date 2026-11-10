import { describe, expect, it } from 'vitest';
import {
  type ActivityEntry,
  MAX_ACTIVITY,
  parseActivity,
  serializeActivity,
  settleActivity,
  upsertActivity,
} from './activity';

const entry = (overrides: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: 't1',
  tool: 'Write',
  target: 'bericht.pdf',
  file: 'bericht.pdf',
  state: 'done',
  ...overrides,
});

describe('serializeActivity/parseActivity: Runderlauf', () => {
  it('speichert nur Werkzeug, Ziel, Datei und Zustand, nie Kennungen oder Inhalte', () => {
    const json = serializeActivity([
      entry({ id: 'a', tool: 'Bash', target: 'Ordner zeigen', file: null, state: 'running' }),
      entry(),
    ]);
    expect(JSON.parse(json ?? '')).toEqual([
      { tool: 'Bash', target: 'Ordner zeigen', file: null, state: 'running' },
      { tool: 'Write', target: 'bericht.pdf', file: 'bericht.pdf', state: 'done' },
    ]);
    expect(parseActivity(json)).toEqual([
      { id: '0', tool: 'Bash', target: 'Ordner zeigen', file: null, state: 'running' },
      { id: '1', tool: 'Write', target: 'bericht.pdf', file: 'bericht.pdf', state: 'done' },
    ]);
  });

  it('gibt für eine leere Liste null und für null eine leere Liste', () => {
    expect(serializeActivity([])).toBeNull();
    expect(parseActivity(null)).toEqual([]);
    expect(parseActivity('')).toEqual([]);
  });
});

describe('parseActivity: Abwärtskompatibilität', () => {
  it('liest alte Einträge ohne das Dateifeld weiter', () => {
    // So sah eine gespeicherte Liste vor H-B04 aus: ohne `file`.
    const alt = '[{"tool":"Write","target":"uebersicht.pdf","state":"done"}]';
    expect(parseActivity(alt)).toEqual([
      { id: '0', tool: 'Write', target: 'uebersicht.pdf', file: null, state: 'done' },
    ]);
  });

  it('verwirft unbekannte Formen und lässt brauchbare Einträge stehen', () => {
    const json = JSON.stringify([
      'Text',
      42,
      null,
      {},
      { tool: 5, target: 'x', state: 'done' },
      { tool: 'Read', target: 'a.md', state: 'kaputt' },
      { tool: 'Read', target: 'a.md', file: 'a.md', state: 'done' },
      { tool: 'Read', target: 'b.md', file: 42, state: 'done' },
    ]);
    expect(parseActivity(json)).toEqual([
      { id: '6', tool: 'Read', target: 'a.md', file: 'a.md', state: 'done' },
      { id: '7', tool: 'Read', target: 'b.md', file: null, state: 'done' },
    ]);
  });

  it('macht aus einem Dateipfad einen reinen Namen und kürzt ihn', () => {
    const json = JSON.stringify([
      { tool: 'Read', target: 'x', file: 'ordner/unter/bericht.pdf', state: 'done' },
      { tool: 'Read', target: 'x', file: 'C:\\Daten\\tabelle.xlsx', state: 'done' },
      { tool: 'Read', target: 'x', file: `${'x'.repeat(90)}.txt`, state: 'done' },
      { tool: 'Read', target: 'x', file: '   ', state: 'done' },
    ]);
    // Harte Kürzung auf 80 Zeichen, ohne Ordneranteile.
    expect(parseActivity(json).map((item) => item.file)).toEqual([
      'bericht.pdf',
      'tabelle.xlsx',
      [...`${'x'.repeat(80)}.txt`].slice(0, 80).join(''),
      null,
    ]);
  });

  it('wirft kaputtes JSON und keine Liste weg', () => {
    expect(parseActivity('kein JSON')).toEqual([]);
    expect(parseActivity('{"tool":"Write"}')).toEqual([]);
  });

  it('behaltet höchstens MAX_ACTIVITY Einträge', () => {
    const many = Array.from({ length: MAX_ACTIVITY + 5 }, (_, n) => ({
      tool: 'Read',
      target: `${n}.md`,
      state: 'done',
    }));
    const list = parseActivity(JSON.stringify(many));
    expect(list).toHaveLength(MAX_ACTIVITY);
  });
});

describe('upsertActivity', () => {
  it('ersetzt einen Eintrag mit gleicher Kennung und hängt neue an', () => {
    const list = upsertActivity(
      upsertActivity([], entry({ id: 'a' })),
      entry({ id: 'b', tool: 'Read' }),
    );
    expect(upsertActivity(list, entry({ id: 'a', state: 'error' }))).toEqual([
      entry({ id: 'a', state: 'error' }),
      entry({ id: 'b', tool: 'Read' }),
    ]);
  });

  it('nimmt über MAX_ACTIVITY hinaus nichts mehr auf', () => {
    let list: ActivityEntry[] = [];
    for (let n = 0; n < MAX_ACTIVITY + 1; n += 1)
      list = upsertActivity(list, entry({ id: `t${n}` }));
    expect(list).toHaveLength(MAX_ACTIVITY);
    // Ein bekannter Eintrag wird auch dann noch ersetzt, wenn die Liste voll ist.
    const updated = upsertActivity(list, entry({ id: 't0', state: 'done' }));
    expect(updated.find((item) => item.id === 't0')?.state).toBe('done');
  });
});

describe('settleActivity', () => {
  it('beendet Offenes: als Fehler bei Abbruch, sonst als erledigt', () => {
    const list = [
      entry({ id: 'a', state: 'running' }),
      entry({ id: 'b', state: 'done' }),
      entry({ id: 'c', state: 'error' }),
    ];
    expect(settleActivity(list, true)).toEqual([
      entry({ id: 'a', state: 'error' }),
      entry({ id: 'b', state: 'done' }),
      entry({ id: 'c', state: 'error' }),
    ]);
    expect(settleActivity(list, false)).toEqual([
      entry({ id: 'a', state: 'done' }),
      entry({ id: 'b', state: 'done' }),
      entry({ id: 'c', state: 'error' }),
    ]);
  });
});
