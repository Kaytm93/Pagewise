import { describe, expect, it } from 'vitest';
import { labelShift, layoutTimeline, MIN_BREAK, NOW_LABEL_HEIGHT, stateOf } from './timeline';

/* Erfundene Zeiten, feste Uhr: Minuten seit Mitternacht (08:00 = 480). */
const at = (hours: number, minutes: number) => hours * 60 + minutes;

const lessons = [
  { id: 'a', start: at(8, 0), end: at(8, 45) },
  { id: 'b', start: at(9, 50), end: at(10, 55) },
  { id: 'c', start: at(11, 30), end: at(12, 15) },
];

describe('layoutTimeline', () => {
  it('legt Stunden und Pausen auf die Achse ab der ersten Stunde', () => {
    const timeline = layoutTimeline(lessons, at(10, 2));
    expect(timeline.origin).toBe(at(8, 0));
    expect(timeline.span).toBe(255);
    expect(timeline.unit).toBe(1.4);
    expect(timeline.blocks.map((b) => [b.kind, b.at, b.len])).toEqual([
      ['lesson', 0, 45],
      ['break', 45, 65],
      ['lesson', 110, 65],
      ['break', 175, 35],
      ['lesson', 210, 45],
    ]);
    expect(timeline.nowAt).toBe(122);
    expect(timeline.runningIndex).toBe(1);
    expect(timeline.markerBefore).toBe(1);
  });

  it('klemmt die Marke vor dem Tag auf den Anfang und nach dem Tag auf das Ende', () => {
    expect(layoutTimeline(lessons, at(6, 0)).nowAt).toBe(0);
    expect(layoutTimeline(lessons, at(6, 0)).markerBefore).toBe(0);
    const after = layoutTimeline(lessons, at(15, 0));
    expect(after.nowAt).toBe(255);
    expect(after.markerBefore).toBe(3);
    expect(after.runningIndex).toBe(-1);
  });

  it('macht erst ab MIN_BREAK Minuten Lücke eine Pause', () => {
    const gap = (minutes: number) =>
      layoutTimeline(
        [
          { id: 'x', start: at(8, 0), end: at(8, 45) },
          { id: 'y', start: at(8, 45) + minutes, end: at(9, 30) + minutes },
        ],
        at(8, 46),
      ).blocks.filter((b) => b.kind === 'break');
    expect(gap(MIN_BREAK - 1)).toHaveLength(0);
    expect(gap(MIN_BREAK)).toHaveLength(1);
  });

  it('verdichtet die Achse, wenn eine Stunde kürzer als 43 Minuten ist (Obergrenze 3 px je Minute)', () => {
    expect(layoutTimeline([{ id: 'k', start: at(8, 0), end: at(8, 30) }], at(8, 5)).unit).toBe(2);
    expect(layoutTimeline([{ id: 'k', start: at(8, 0), end: at(8, 10) }], at(8, 5)).unit).toBe(3);
  });

  it('sortiert und schiebt überschneidende Stunden hinter die vorige', () => {
    const timeline = layoutTimeline(
      [
        { id: 'late', start: at(8, 30), end: at(9, 30) },
        { id: 'early', start: at(8, 0), end: at(9, 0) },
      ],
      at(8, 10),
    );
    expect(timeline.blocks.map((b) => [b.id, b.at, b.len])).toEqual([
      ['early', 0, 60],
      ['late', 60, 30],
    ]);
  });

  it('gibt für einen leeren Tag eine leere Achse zurück', () => {
    const timeline = layoutTimeline([], at(10, 0));
    expect(timeline.blocks).toEqual([]);
    expect(timeline.span).toBe(0);
  });
});

describe('labelShift: der Zettel verdeckt keine Startzeit', () => {
  it('steht zentriert, wenn nichts in der Nähe liegt', () => {
    expect(labelShift(200, [0, 400])).toBe(-NOW_LABEL_HEIGHT / 2);
  });

  it('weicht nach oben aus, wenn eine Startzeit auf Höhe der Marke liegt', () => {
    // Beschriftung der Stunde 196 bis 214; der Zettel (30 px) muss ganz darüber enden: Versatz −34.
    expect(labelShift(200, [195])).toBe(-34);
    // Beschriftung 206 bis 224: darüber enden bei 206 heißt Versatz −24.
    expect(labelShift(200, [205])).toBe(-24);
  });

  it('weicht nach unten aus, wenn darüber kein Platz ist', () => {
    // Marke bei 170,8 px, Beschriftung 155 bis 173, darüber 136 px frei, aber über 36 px entfernt:
    // der nächste freie Versatz liegt direkt unter der Marke.
    expect(labelShift(170.8, [0, 154, 294])).toBe(3);
  });

  it('bleibt zentriert, wenn die Beschriftung nicht ins Gehege kommt', () => {
    expect(labelShift(200, [225])).toBe(-NOW_LABEL_HEIGHT / 2);
  });

  it('fällt auf zentriert zurück, wenn nirgends Platz ist', () => {
    expect(labelShift(100, [70, 100, 130])).toBe(-NOW_LABEL_HEIGHT / 2);
  });
});

describe('stateOf', () => {
  it('unterscheidet vorbei, laufend und kommend an den Grenzen', () => {
    expect(stateOf(480, 525, 525)).toBe('past');
    expect(stateOf(480, 525, 480)).toBe('now');
    expect(stateOf(480, 525, 479)).toBe('next');
  });
});
