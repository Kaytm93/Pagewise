import { describe, expect, it } from 'vitest';
import { SHA_A, SHA_B } from './test-support';
import {
  buildUpdateView,
  LOG_LINES_SHOWN,
  type UpdateState,
  updateMenuKey,
  type ViewExtras,
} from './view';

const EXTRAS: ViewExtras = {
  installed: { commit: SHA_A, commitDate: '2026-10-01T12:00:00Z', builtAt: null, dirty: false },
  autoCheck: false,
  formatDate: (iso) => iso.slice(0, 10),
  formatTime: () => '14:32',
};

const STATE: UpdateState = {
  stage: 'idle',
  unsupported: null,
  remote: null,
  changes: [],
  changeCount: null,
  step: null,
  lines: [],
  error: null,
  checkedAt: null,
  ready: null,
  message: null,
};
const view = (patch: Partial<UpdateState>, extras: Partial<ViewExtras> = {}) =>
  buildUpdateView({ ...STATE, ...patch }, { ...EXTRAS, ...extras });
const ids = (v: ReturnType<typeof view>) => v.actions.map((a) => a.id);

describe('Update-Fenster: Ansicht', () => {
  it('beginnt mit „Nach Updates suchen“ und zeigt die installierte Fassung', () => {
    const v = view({});
    expect(v.stage).toBe('idle');
    expect(ids(v)).toEqual(['check']);
    expect(v.facts).toEqual([{ label: 'Installiert', value: 'aaaaaaa · 2026-10-01' }]);
    expect(v.busy).toBe(false);
    expect(v.autoCheck).toMatchObject({ checked: false, label: 'Beim Start nach Updates suchen' });
  });

  it('zeigt eine unbekannte Fassung und lokale Änderungen ehrlich', () => {
    expect(
      view({}, { installed: { commit: null, commitDate: null, builtAt: null, dirty: false } })
        .facts[0]?.value,
    ).toBe('unbekannt');
    expect(
      view({}, { installed: { commit: SHA_A, commitDate: null, builtAt: null, dirty: true } })
        .facts[0]?.value,
    ).toBe('aaaaaaa · mit lokalen Änderungen gebaut');
  });

  it('meldet „aktuell“ mit der Uhrzeit der Prüfung und bietet erneutes Prüfen an', () => {
    const v = view({ stage: 'up-to-date', checkedAt: new Date('2026-10-17T12:32:00Z') });
    expect(v.title).toBe('Pagewise ist auf dem neuesten Stand');
    expect(v.body).toBe('Zuletzt geprüft: 14:32 Uhr.');
    expect(ids(v)).toEqual(['recheck']);
  });

  it('zeigt bei einem Update die neue Fassung, die Änderungen und „Jetzt aktualisieren“', () => {
    const v = view({
      stage: 'available',
      remote: { commit: SHA_B, date: '2026-10-16T09:00:00Z' },
      changes: ['fix: Eins', 'feat: Zwei'],
      changeCount: 5,
    });
    expect(ids(v)).toEqual(['start', 'recheck']);
    expect(v.facts.map((f) => f.label)).toEqual(['Installiert', 'Neu']);
    expect(v.facts[1]?.value).toBe('bbbbbbb · 2026-10-16');
    expect(v.changes).toEqual({
      label: 'Was neu ist',
      items: ['fix: Eins', 'feat: Zwei'],
      more: 'und 3 weitere',
      unknown: null,
    });
  });

  it('sagt, wenn die Liste der Änderungen erst nach dem Herunterladen kommt', () => {
    const v = view({ stage: 'available', remote: { commit: SHA_B, date: null } });
    expect(v.changes?.items).toEqual([]);
    expect(v.changes?.unknown).toContain('nach dem Herunterladen');
  });

  it('zeigt beim Vorbereiten die Schritte, die Ausgabe (nur die letzten Zeilen) und „Abbrechen“', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `Zeile ${i}`);
    const v = view({
      stage: 'working',
      step: 'build',
      lines,
      remote: { commit: SHA_B, date: null },
    });
    expect(v.busy).toBe(true);
    expect(ids(v)).toEqual(['cancel']);
    expect(v.steps?.map((s) => [s.id, s.state])).toEqual([
      ['fetch', 'done'],
      ['install', 'done'],
      ['build', 'active'],
      ['verify', 'pending'],
    ]);
    expect(v.stepNote).toBe('Schritt 3 von 4');
    expect(v.log?.lines).toHaveLength(LOG_LINES_SHOWN);
    expect(v.log?.lines.at(-1)).toBe('Zeile 39');
  });

  it('bietet bei einer bereiten Fassung den Neustart an', () => {
    const v = view({
      stage: 'ready',
      remote: { commit: SHA_B, date: null },
      ready: { commit: SHA_B, commitDate: null, appPath: '/x', builtAt: '' },
    });
    expect(ids(v)).toEqual(['restart', 'recheck']);
    expect(v.title).toBe('Das Update ist bereit');
    expect(v.busy).toBe(false);
  });

  it('erklärt Fehler in Worten, nennt die unveränderte App und wiederholt die richtige Aufgabe', () => {
    const prepare = view({
      stage: 'failed',
      error: { code: 'build-failed', during: 'prepare' },
      step: 'build',
      lines: ['boom'],
    });
    expect(prepare.body).toContain('Bauen der App ist gescheitert');
    expect(prepare.untouched).toBe('Die installierte App und deine Daten sind unverändert.');
    expect(ids(prepare)).toEqual(['retry-start', 'show-log']);
    expect(prepare.steps?.filter((s) => s.state === 'done').map((s) => s.id)).toEqual([
      'fetch',
      'install',
    ]);
    const check = view({ stage: 'failed', error: { code: 'network', during: 'check' } });
    expect(ids(check)).toEqual(['retry-check']);
    expect(check.body).toContain('GitHub ist gerade nicht erreichbar');
  });

  it('erklärt, warum Updates hier nicht gehen, und bietet nichts an', () => {
    const v = view({ stage: 'unsupported', unsupported: 'dev' });
    expect(v.actions).toEqual([]);
    expect(v.body).toContain('Entwicklungsfassung');
    expect(v.facts).toEqual([]);
  });

  it('zeigt die Meldung der letzten Aktion', () => {
    expect(view({ message: 'cancelled' }).message).toBe('Abgebrochen.');
    expect(view({}).message).toBeNull();
  });

  it('beschriftet den Menüpunkt nach dem Zustand', () => {
    expect(updateMenuKey('idle')).toBe('checkForUpdates');
    expect(updateMenuKey('up-to-date')).toBe('checkForUpdates');
    expect(updateMenuKey('available')).toBe('updateAvailable');
    expect(updateMenuKey('working')).toBe('updateWorking');
    expect(updateMenuKey('ready')).toBe('updateReady');
    expect(updateMenuKey('failed')).toBe('updateFailed');
  });

  it('kann nichts mit Markup anfangen: alle Texte sind Klartext', () => {
    const v = view({
      stage: 'available',
      remote: { commit: SHA_B, date: null },
      changes: ['<img src=x onerror=alert(1)>'],
    });
    expect(JSON.stringify(v)).toContain('<img src=x onerror=alert(1)>');
    // Die Seite setzt es mit textContent ein (Strukturtest); die Ansicht reicht es unverändert als Text durch.
    expect(v.changes?.items[0]).toBe('<img src=x onerror=alert(1)>');
  });
});
