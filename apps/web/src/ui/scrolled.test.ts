// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCROLLED_ATTRIBUTE, SCROLLED_THRESHOLD, startScrolledState } from './scrolled';

/* Scroll-Zustand des Kopfes der schmalen Breite (D-083): data-scrolled ab etwas mehr als 4 px, sonst weg. */

let target: HTMLElement;
let stop: (() => void) | undefined;

function scrollTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  window.dispatchEvent(new Event('scroll'));
}

const scrolled = () => target.hasAttribute(SCROLLED_ATTRIBUTE);

beforeEach(() => {
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  target = document.createElement('header');
  document.body.append(target);
});

afterEach(() => {
  stop?.();
  stop = undefined;
  target.remove();
  vi.restoreAllMocks();
});

describe('startScrolledState', () => {
  it('heißt data-scrolled und kennt eine Schwelle von 4 px', () => {
    expect(SCROLLED_ATTRIBUTE).toBe('data-scrolled');
    expect(SCROLLED_THRESHOLD).toBe(4);
  });

  it('lässt den Kopf oben ohne Attribut', () => {
    stop = startScrolledState(target);
    expect(scrolled()).toBe(false);
  });

  it('setzt das Attribut, sobald die Seite um mehr als die Schwelle gescrollt ist', () => {
    stop = startScrolledState(target);
    scrollTo(SCROLLED_THRESHOLD + 1);
    expect(scrolled()).toBe(true);
    expect(target.getAttribute(SCROLLED_ATTRIBUTE)).toBe('');
  });

  it('setzt es noch nicht bei genau der Schwelle', () => {
    stop = startScrolledState(target);
    scrollTo(SCROLLED_THRESHOLD);
    expect(scrolled()).toBe(false);
    scrollTo(SCROLLED_THRESHOLD + 0.5);
    expect(scrolled()).toBe(true);
  });

  it('entfernt es wieder, wenn die Seite oben ist', () => {
    stop = startScrolledState(target);
    scrollTo(300);
    expect(scrolled()).toBe(true);
    scrollTo(0);
    expect(scrolled()).toBe(false);
  });

  it('bleibt beim Gummiband-Überzug oberhalb von 0 (negative Höhe) ungescrollt', () => {
    stop = startScrolledState(target);
    scrollTo(-40);
    expect(scrolled()).toBe(false);
    scrollTo(120);
    scrollTo(-12);
    expect(scrolled()).toBe(false);
  });

  it('übernimmt eine wiederhergestellte Scrollhöhe schon beim Start', () => {
    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true });
    stop = startScrolledState(target);
    expect(scrolled()).toBe(true);
  });

  it('schreibt nur bei einem Wechsel des Zustands, nicht bei jedem Scroll-Ereignis', () => {
    stop = startScrolledState(target);
    const set = vi.spyOn(target, 'setAttribute');
    const remove = vi.spyOn(target, 'removeAttribute');
    for (const y of [10, 40, 90, 400, 800]) scrollTo(y);
    expect(set).toHaveBeenCalledTimes(1);
    scrollTo(0);
    scrollTo(0);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('nimmt einen anderen Schwellenwert an', () => {
    stop = startScrolledState(target, 50);
    scrollTo(40);
    expect(scrolled()).toBe(false);
    scrollTo(51);
    expect(scrolled()).toBe(true);
  });

  it('hängt den Scroll-Listener passiv an und beim Aufräumen wieder ab', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    stop = startScrolledState(target);
    const call = add.mock.calls.find(([type]) => type === 'scroll');
    expect(call?.[2]).toEqual({ passive: true });
    stop();
    stop = undefined;
    expect(
      remove.mock.calls.some(([type, handler]) => type === 'scroll' && handler === call?.[1]),
    ).toBe(true);
  });

  it('räumt auf: Attribut weg, spätere Scroll-Ereignisse ändern nichts mehr', () => {
    stop = startScrolledState(target);
    scrollTo(200);
    expect(scrolled()).toBe(true);
    stop();
    stop = undefined;
    expect(scrolled()).toBe(false);
    scrollTo(400);
    expect(scrolled()).toBe(false);
  });

  it('verwendet kein style-Attribut (strenge CSP)', () => {
    stop = startScrolledState(target);
    scrollTo(200);
    expect(target.hasAttribute('style')).toBe(false);
  });
});
