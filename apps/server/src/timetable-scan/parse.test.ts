import { describe, expect, it } from 'vitest';
import { MAX_SCAN_ENTRIES, parseScanReply } from './parse';

const reply = (entries: unknown[]) => JSON.stringify({ entries });
const lesson = {
  weekday: 1,
  startTime: '08:00',
  endTime: '08:45',
  subject: 'Beispielfach A',
  room: 'Raum 1',
  note: null,
  week: 'all',
};

describe('Antwort des Vision-Modells', () => {
  it('liest ein reines JSON-Objekt und behält nur bekannte Felder', () => {
    const parsed = parseScanReply(reply([{ ...lesson, erfunden: 'ignoriert' }]));
    expect(parsed.entries).toEqual([
      {
        weekday: 1,
        startTime: '08:00',
        endTime: '08:45',
        subject: 'Beispielfach A',
        room: 'Raum 1',
        note: null,
        week: 'all',
      },
    ]);
    expect(parsed.skipped).toBe(0);
  });

  it('verträgt einen Code-Block und normalisiert Zeiten, Wochentage und Wochen', () => {
    const text = `Hier die Daten:\n\`\`\`json\n${reply([
      { weekday: 'Mi', startTime: '8:05', endTime: '8.50', subject: 'Beispielfach B', week: 'A' },
    ])}\n\`\`\`\nDanke.`;
    expect(parseScanReply(text).entries).toEqual([
      {
        weekday: 3,
        startTime: '08:05',
        endTime: '08:50',
        subject: 'Beispielfach B',
        room: null,
        note: null,
        week: 'a',
      },
    ]);
  });

  it('verwirft unbrauchbare und doppelte Angaben, ohne die gültigen zu verlieren', () => {
    const parsed = parseScanReply(
      reply([
        lesson,
        { ...lesson },
        { ...lesson, weekday: 9 },
        { ...lesson, startTime: '25:00' },
        { ...lesson, endTime: '07:00' },
        { ...lesson, weekday: 0, subject: 'x'.repeat(200) },
        'kein Objekt',
      ]),
    );
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.skipped).toBe(6);
  });

  it('behält eine Stunde, deren Fach zu lang ist, aber ohne dieses Fach', () => {
    const parsed = parseScanReply(reply([{ ...lesson, subject: 'x'.repeat(200) }]));
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.subject).toBeNull();
  });

  it('nimmt bei Prosa, kaputtem JSON und fehlendem Feld nichts an', () => {
    expect(parseScanReply('Das Bild zeigt einen Stundenplan.').entries).toEqual([]);
    expect(parseScanReply('{kaputt').entries).toEqual([]);
    expect(parseScanReply(JSON.stringify({ lessons: [lesson] })).entries).toEqual([]);
    expect(parseScanReply(reply([])).entries).toEqual([]);
  });

  it('lässt keine Steuerzeichen in erkannten Fächern und Räumen durch', () => {
    const parsed = parseScanReply(
      reply([{ ...lesson, subject: 'Beispielfach\u0007 A', room: 'Raum\u0000 1' }]),
    );
    expect(parsed.entries[0]?.subject).toBeNull();
    expect(parsed.entries[0]?.room).toBeNull();
  });

  it('begrenzt die Zahl der Stunden', () => {
    const many = Array.from({ length: MAX_SCAN_ENTRIES + 12 }, (_, index) => ({
      ...lesson,
      startTime: '08:00',
      endTime: '08:45',
      subject: `Beispielfach ${index}`,
    }));
    const parsed = parseScanReply(reply(many));
    expect(parsed.entries).toHaveLength(MAX_SCAN_ENTRIES);
    expect(parsed.skipped).toBe(12);
  });
});
