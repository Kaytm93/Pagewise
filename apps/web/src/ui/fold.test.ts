import { describe, expect, it } from 'vitest';
import { foldName } from './fold';

describe('foldName', () => {
  it.each([
    ['Französisch', 'franzoesisch'],
    ['FRANZOESISCH', 'franzoesisch'],
    ['  Straße  ', 'strasse'],
    ['Café  Müller', 'cafe mueller'],
    ['Ärzte', 'aerzte'],
    ['Mathematik', 'mathematik'],
  ])('faltet %j zu %j', (input, expected) => {
    expect(foldName(input)).toBe(expected);
  });

  it('macht Schreibweisen mit und ohne Umlaut vergleichbar', () => {
    expect(foldName('Übung')).toBe(foldName('uebung'));
    expect(foldName('Öl')).toBe(foldName('OEL'));
  });
});
