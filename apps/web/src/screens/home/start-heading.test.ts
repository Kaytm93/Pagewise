import { describe, expect, it } from 'vitest';
import type { Exam, TimetableEntry } from '../../api/types';
import { startHeading, startHeadingFor } from './start-heading';

// Alle Daten sind erfunden. Montag, 5. Oktober 2026.
const TODAY = '2026-10-05';
const exam = (kind: string, subject: string | null, date: string) => ({ kind, subject, date });
const base = { today: TODAY, lessonsToday: 4, lessonsLeft: 4, exam: null };

describe('startHeading', () => {
  it('nennt Stunden und den nächsten Test in einem Satz', () => {
    expect(
      startHeading({ ...base, exam: exam('Schulaufgabe', 'Beispielfach A', '2026-10-08') }),
    ).toBe('Heute 4 Stunden, Schulaufgabe Beispielfach A in 3 Tagen.');
  });

  it('kennt Einzahl und Mehrzahl bei Stunden', () => {
    expect(startHeading({ ...base, lessonsToday: 1, lessonsLeft: 1 })).toBe('Heute eine Stunde.');
    expect(startHeading({ ...base, lessonsToday: 2, lessonsLeft: 2 })).toBe('Heute 2 Stunden.');
  });

  it('zählt nur die verbleibenden Stunden, sobald die erste vorbei ist', () => {
    expect(startHeading({ ...base, lessonsLeft: 3 })).toBe('Noch 3 Stunden heute.');
    expect(startHeading({ ...base, lessonsLeft: 1 })).toBe('Noch eine Stunde heute.');
  });

  it('sagt „Für heute ist Schluss“, wenn alle Stunden vorbei sind', () => {
    expect(startHeading({ ...base, lessonsLeft: 0 })).toBe('Für heute ist Schluss.');
    expect(
      startHeading({ ...base, lessonsLeft: 0, exam: exam('Ex', 'Beispielfach B', '2026-10-06') }),
    ).toBe('Für heute ist Schluss, Ex Beispielfach B morgen.');
  });

  it('formuliert „morgen“ und „heute“ ohne doppeltes „heute“', () => {
    expect(startHeading({ ...base, exam: exam('Test', 'Beispielfach A', '2026-10-06') })).toBe(
      'Heute 4 Stunden, Test Beispielfach A morgen.',
    );
    expect(startHeading({ ...base, exam: exam('Test', 'Beispielfach A', TODAY) })).toBe(
      'Heute 4 Stunden und Test Beispielfach A.',
    );
    expect(
      startHeading({ ...base, lessonsLeft: 2, exam: exam('Test', 'Beispielfach A', TODAY) }),
    ).toBe('Noch 2 Stunden heute und Test Beispielfach A.');
  });

  it('lässt einen Test von heute weg, wenn der Tag schon gelaufen ist', () => {
    expect(
      startHeading({ ...base, lessonsLeft: 0, exam: exam('Test', 'Beispielfach A', TODAY) }),
    ).toBe('Für heute ist Schluss.');
  });

  it('zeigt ohne Stunden nur den Test', () => {
    expect(
      startHeading({
        ...base,
        lessonsToday: 0,
        lessonsLeft: 0,
        exam: exam('Referat', 'Beispielfach C', '2026-10-12'),
      }),
    ).toBe('Referat Beispielfach C in 7 Tagen.');
    expect(
      startHeading({
        ...base,
        lessonsToday: 0,
        lessonsLeft: 0,
        exam: exam('Referat', 'Beispielfach C', TODAY),
      }),
    ).toBe('Referat Beispielfach C heute.');
  });

  it('nennt bei unbekanntem Fach nur die Art des Tests', () => {
    expect(startHeading({ ...base, exam: exam('Schulaufgabe', null, '2026-10-08') })).toBe(
      'Heute 4 Stunden, Schulaufgabe in 3 Tagen.',
    );
  });

  it('gibt null zurück, wenn es weder Stunden noch einen Test gibt (Rückfall auf den festen Text)', () => {
    expect(startHeading({ ...base, lessonsToday: 0, lessonsLeft: 0 })).toBeNull();
  });

  it('ignoriert einen Test mit leerer Art und leerem Fach sowie einen vergangenen Test', () => {
    expect(
      startHeading({
        ...base,
        lessonsToday: 0,
        lessonsLeft: 0,
        exam: exam('', null, '2026-10-08'),
      }),
    ).toBeNull();
    expect(
      startHeading({
        ...base,
        lessonsToday: 0,
        lessonsLeft: 0,
        exam: exam('Test', 'Beispielfach A', '2026-10-01'),
      }),
    ).toBeNull();
  });
});

describe('startHeadingFor', () => {
  const lesson = (id: string, startTime: string, endTime: string): TimetableEntry => ({
    id,
    weekday: 1,
    startTime,
    endTime,
    subjectId: 's1',
    room: null,
    note: null,
    week: 'all',
  });
  const entries = [
    lesson('a', '08:00', '08:45'),
    lesson('b', '09:00', '09:45'),
    lesson('c', '10:00', '10:45'),
    lesson('d', '11:00', '11:45'),
  ];
  const upcoming: Exam = {
    id: 'x1',
    subjectId: 's1',
    kind: 'Schulaufgabe',
    title: null,
    date: '2026-10-08',
    time: null,
    topics: null,
    notes: null,
  };
  const subjectName = (id: string) => (id === 's1' ? 'Beispielfach A' : null);
  const at = (hours: number, minutes: number) => new Date(2026, 9, 5, hours, minutes);

  it('liest Stunden und Test aus den geladenen Plandaten', () => {
    expect(
      startHeadingFor({
        entries,
        exams: [upcoming],
        weekAnchor: null,
        now: at(7, 30),
        subjectName,
      }),
    ).toBe('Heute 4 Stunden, Schulaufgabe Beispielfach A in 3 Tagen.');
  });

  it('zählt die laufende Stunde mit, die vorbeigegangenen nicht', () => {
    expect(
      startHeadingFor({ entries, exams: [], weekAnchor: null, now: at(10, 20), subjectName }),
    ).toBe('Noch 2 Stunden heute.');
  });

  it('fällt ohne Stundenplan und ohne Tests auf null zurück', () => {
    expect(
      startHeadingFor({ entries: [], exams: [], weekAnchor: null, now: at(10, 20), subjectName }),
    ).toBeNull();
  });
});
