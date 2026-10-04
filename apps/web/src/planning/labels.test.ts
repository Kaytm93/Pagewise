import { describe, expect, it } from 'vitest';
import { relativeDay } from './labels';

describe('relativeDay', () => {
  it.each([
    ['2026-10-04', 'heute'],
    ['2026-10-05', 'morgen'],
    ['2026-10-03', 'gestern'],
    ['2026-10-08', 'in 4 Tagen'],
    ['2026-10-01', 'vor 3 Tagen'],
    ['2026-11-04', 'in 31 Tagen'],
  ])('%s ist %s', (date, text) => {
    expect(relativeDay(date, '2026-10-04')).toBe(text);
  });
});
