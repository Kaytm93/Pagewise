import { describe, expect, it } from 'vitest';
import { buildHistory, HISTORY_MAX_CHARACTERS, titleFrom } from './history';

const turn = (role: 'user' | 'assistant', content: string, status = 'complete') => ({
  role,
  content,
  status,
});

describe('buildHistory', () => {
  it('übernimmt abwechselnde Nachrichten in der Reihenfolge', () => {
    expect(
      buildHistory([
        turn('user', 'Frage eins'),
        turn('assistant', 'Antwort eins'),
        turn('user', 'Frage zwei'),
      ]),
    ).toEqual([
      { role: 'user', content: 'Frage eins' },
      { role: 'assistant', content: 'Antwort eins' },
      { role: 'user', content: 'Frage zwei' },
    ]);
  });

  it('lässt Antworten ohne Text weg und verbindet danach gleiche Rollen', () => {
    const history = buildHistory([
      turn('user', 'Erste Frage'),
      turn('assistant', '', 'error'),
      turn('user', 'Dieselbe Frage noch einmal'),
      turn('assistant', '   ', 'stopped'),
      turn('assistant', '', 'streaming'),
    ]);
    expect(history).toEqual([
      { role: 'user', content: 'Erste Frage\n\nDieselbe Frage noch einmal' },
    ]);
  });

  it('behält Teilantworten, auch wenn sie abgebrochen oder fehlerhaft endeten', () => {
    const history = buildHistory([
      turn('user', 'Frage'),
      turn('assistant', 'Halber Sa', 'error'),
      turn('user', 'Weiter bitte'),
    ]);
    expect(history.map((entry) => entry.content)).toEqual(['Frage', 'Halber Sa', 'Weiter bitte']);
  });

  it('kürzt von vorn, behält die letzte Nachricht und beginnt mit dem Nutzer', () => {
    const history = buildHistory(
      [
        turn('user', 'a'.repeat(40)),
        turn('assistant', 'b'.repeat(40)),
        turn('user', 'c'.repeat(40)),
        turn('assistant', 'd'.repeat(40)),
        turn('user', 'e'.repeat(40)),
      ],
      100,
    );
    // 40 + 40 + 40 passt nicht in 100: es bleiben die letzten beiden, davon beginnt die Antwort nicht.
    expect(history).toEqual([{ role: 'user', content: 'e'.repeat(40) }]);
  });

  it('behält die letzte Nachricht auch dann, wenn sie allein über der Grenze liegt', () => {
    const history = buildHistory([turn('user', 'x'.repeat(500))], 100);
    expect(history).toHaveLength(1);
  });

  it('zählt Zeichen und nicht UTF-16-Einheiten', () => {
    const emoji = '😀'.repeat(30);
    expect(buildHistory([turn('user', emoji)], 30)).toHaveLength(1);
    // 30 + 2 + 5 Zeichen passen nicht in 35: die älteste Frage fällt weg, die Antwort bliebe am Anfang.
    expect(
      buildHistory([turn('user', emoji), turn('assistant', 'ok'), turn('user', 'frage')], 35),
    ).toEqual([{ role: 'user', content: 'frage' }]);
  });

  it('hat eine großzügige Standardgrenze', () => {
    expect(HISTORY_MAX_CHARACTERS).toBeGreaterThanOrEqual(100_000);
  });

  it('gibt bei leerem Verlauf nichts zurück', () => {
    expect(buildHistory([])).toEqual([]);
  });
});

describe('titleFrom', () => {
  it('nimmt die erste nicht leere Zeile und zieht Leerraum zusammen', () => {
    expect(titleFrom('\n\n  Was   ist  eine\tAbleitung?  \nZweite Zeile')).toBe(
      'Was ist eine Ableitung?',
    );
  });

  it('kürzt lange Titel mit Auslassungszeichen auf 60 Zeichen', () => {
    const title = titleFrom('x'.repeat(100));
    expect([...title]).toHaveLength(60);
    expect(title.endsWith('…')).toBe(true);
  });

  it('lässt kurze Titel unverändert', () => {
    expect(titleFrom('Kurz')).toBe('Kurz');
  });

  it('zerlegt keine Zeichen aus mehreren Einheiten', () => {
    const title = titleFrom('😀'.repeat(80));
    expect([...title]).toHaveLength(60);
    expect(title).not.toContain('�');
  });
});
