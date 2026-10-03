import { describe, expect, it } from 'vitest';
import { formatWhen } from './when';

describe('formatWhen', () => {
  const now = new Date(2026, 9, 3, 15, 30).getTime();

  it('nennt heute und gestern mit Uhrzeit', () => {
    expect(formatWhen(new Date(2026, 9, 3, 9, 5).getTime(), now)).toBe('heute, 09:05');
    expect(formatWhen(new Date(2026, 9, 2, 23, 59).getTime(), now)).toBe('gestern, 23:59');
  });

  it('nennt ältere Tage mit Datum, im Vorjahr mit Jahr', () => {
    expect(formatWhen(new Date(2026, 8, 20, 12, 0).getTime(), now)).toMatch(/^20\. Sept\.?$/);
    expect(formatWhen(new Date(2025, 11, 24, 12, 0).getTime(), now)).toMatch(/2025/);
  });
});
