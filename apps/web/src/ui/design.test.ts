// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyDesign,
  DEFAULT_DESIGN,
  DESIGN_EVENT,
  DESIGNS,
  readDesign,
  saveDesign,
} from './design';

const attr = () => document.documentElement.getAttribute('data-design');

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-design');
});

describe('Designrichtung', () => {
  it('kennt drei Richtungen, Voreinstellung ist „Raum“', () => {
    expect(DESIGNS).toEqual(['raum', 'lagen', 'atelier']);
    expect(DEFAULT_DESIGN).toBe('raum');
    expect(readDesign()).toBe('raum');
  });

  it('liest nur bekannte gespeicherte Werte', () => {
    window.localStorage.setItem('pagewise.design', 'atelier');
    expect(readDesign()).toBe('atelier');
    window.localStorage.setItem('pagewise.design', 'wild');
    expect(readDesign()).toBe('raum');
  });

  it('setzt das Attribut, speichert die Wahl und meldet die Änderung', () => {
    const listener = vi.fn();
    window.addEventListener(DESIGN_EVENT, listener);
    saveDesign('lagen');
    expect(attr()).toBe('lagen');
    expect(window.localStorage.getItem('pagewise.design')).toBe('lagen');
    expect(listener).toHaveBeenCalledTimes(1);
    applyDesign('atelier');
    expect(attr()).toBe('atelier');
    window.removeEventListener(DESIGN_EVENT, listener);
  });

  it('fällt ohne Speicher auf die Voreinstellung zurück', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('gesperrt');
    });
    expect(readDesign()).toBe('raum');
    vi.restoreAllMocks();
  });
});

describe('boot.js: Designrichtung', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'boot.js'),
    'utf8',
  );
  const run = () => new Function(source)();

  it('nutzt denselben Schlüssel und dieselben Werte wie das Modul', () => {
    expect(source).toContain("'pagewise.design'");
    for (const design of DESIGNS) expect(source).toContain(`'${design}'`);
  });

  it('setzt die gespeicherte Richtung, sonst „Raum“', () => {
    run();
    expect(attr()).toBe('raum');
    window.localStorage.setItem('pagewise.design', 'atelier');
    run();
    expect(attr()).toBe('atelier');
    window.localStorage.setItem('pagewise.design', 'wild');
    run();
    expect(attr()).toBe('raum');
  });
});
