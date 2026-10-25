// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDesign } from './design';
import { acquirePointerGlow, isGlowActive, startPointerGlow, usePointerGlow } from './pointer-glow';

/*
 * Zeigerlicht (Atelier): `--gx` und `--gy` kommen über das CSSOM auf das Element unter dem Zeiger, nur bei
 * „Atelier“, „Voll“, feinem Zeiger und sichtbarem Tab, höchstens einmal je Bild. Die Ereignisse sind erfunden
 * (MouseEvent mit `pointerType`), `requestAnimationFrame` und `matchMedia` sind ersetzt.
 */

const root = document.documentElement;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let fine: boolean;
let requested: number;

function flush() {
  const queue = [...frames.values()];
  frames.clear();
  for (const callback of queue) callback(0);
}

function move(target: Element, x: number, y: number, pointerType = 'mouse') {
  const event = new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  target.dispatchEvent(event);
}

function card(left: number, top: number, className = 'lg-slip') {
  const element = document.createElement('div');
  element.className = className;
  element.getBoundingClientRect = () => new DOMRect(left, top, 200, 100);
  document.body.append(element);
  return element;
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  requested = 0;
  fine = true;
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => {
      nextFrame += 1;
      requested += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    },
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: (id: number) => {
      frames.delete(id);
    },
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => ({
      get matches() {
        return fine;
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  root.setAttribute('data-design', 'atelier');
  root.className = 'fx-full';
});

afterEach(() => {
  document.body.replaceChildren();
  root.removeAttribute('data-design');
  root.className = '';
});

describe('startPointerGlow', () => {
  it('setzt --gx und --gy relativ zum Element unter dem Zeiger, ein Bild später', () => {
    const element = card(100, 50);
    const stop = startPointerGlow();

    move(element, 130, 90);
    expect(element.style.getPropertyValue('--gx')).toBe('');
    flush();
    expect(element.style.getPropertyValue('--gx')).toBe('30px');
    expect(element.style.getPropertyValue('--gy')).toBe('40px');
    stop();
  });

  it('findet das Ziel auch über ein Kind und nimmt für Seitenleiste, Zeilen und Kachelrand dieselben Variablen', () => {
    const binder = card(0, 0, 'lg-binder');
    const row = card(10, 10, 'lg-row');
    const edge = card(20, 20, 'at-glow-edge');
    const child = document.createElement('span');
    row.append(child);
    const stop = startPointerGlow();

    move(binder, 5, 6);
    flush();
    move(child, 40, 30);
    flush();
    move(edge, 50, 70);
    flush();

    expect(binder.style.getPropertyValue('--gx')).toBe('5px');
    expect(row.style.getPropertyValue('--gx')).toBe('30px');
    expect(row.style.getPropertyValue('--gy')).toBe('20px');
    expect(edge.style.getPropertyValue('--gy')).toBe('50px');
    stop();
  });

  it('plant mehrere Bewegungen im selben Bild nur einmal und nimmt die letzte', () => {
    const element = card(0, 0);
    const stop = startPointerGlow();

    move(element, 10, 10);
    move(element, 20, 20);
    move(element, 60, 40);
    expect(requested).toBe(1);
    flush();
    expect(element.style.getPropertyValue('--gx')).toBe('60px');
    expect(element.style.getPropertyValue('--gy')).toBe('40px');
    stop();
  });

  it('ignoriert Elemente ohne Schein', () => {
    const plain = card(0, 0, 'andere-klasse');
    const stop = startPointerGlow();

    move(plain, 10, 10);
    flush();
    expect(plain.style.getPropertyValue('--gx')).toBe('');
    stop();
  });

  it.each([
    ['bei Touch', () => move(card(0, 0), 5, 5, 'touch')],
    [
      'ohne feinen Zeiger',
      () => {
        fine = false;
        move(card(0, 0), 5, 5);
      },
    ],
    [
      'in „Reduziert“',
      () => {
        root.className = 'fx-reduced';
        move(card(0, 0), 5, 5);
      },
    ],
    [
      'in „Aus“',
      () => {
        root.className = 'fx-off';
        move(card(0, 0), 5, 5);
      },
    ],
    [
      'bei verstecktem Tab',
      () => {
        root.className = 'fx-full tab-hidden';
        move(card(0, 0), 5, 5);
      },
    ],
    [
      'in einer anderen Richtung',
      () => {
        root.setAttribute('data-design', 'raum');
        move(card(0, 0), 5, 5);
      },
    ],
  ])('setzt nichts %s', (_name, act_) => {
    const stop = startPointerGlow();
    act_();
    flush();
    expect(document.querySelectorAll('[style]')).toHaveLength(0);
    expect(requested).toBe(0);
    stop();
  });

  it('nimmt den Schein zurück, wenn die Bedingungen wegfallen', () => {
    const element = card(0, 0);
    const stop = startPointerGlow();
    move(element, 10, 10);
    flush();
    expect(element.style.getPropertyValue('--gx')).toBe('10px');

    root.className = 'fx-reduced';
    move(element, 20, 20);
    expect(element.style.getPropertyValue('--gx')).toBe('');
    stop();
  });

  it('räumt beim Beenden auf: Variablen weg, Bild abgebrochen, keine Reaktion mehr', () => {
    const element = card(0, 0);
    const stop = startPointerGlow();
    move(element, 10, 10);
    flush();
    move(element, 30, 30);
    stop();

    expect(frames.size).toBe(0);
    expect(element.style.getPropertyValue('--gx')).toBe('');
    move(element, 50, 50);
    flush();
    expect(element.style.getPropertyValue('--gx')).toBe('');
  });
});

describe('isGlowActive', () => {
  it('verlangt Atelier, „Voll“ und einen sichtbaren Tab', () => {
    expect(isGlowActive()).toBe(true);
    root.className = 'fx-full tab-hidden';
    expect(isGlowActive()).toBe(false);
    root.className = 'fx-off';
    expect(isGlowActive()).toBe(false);
    root.className = 'fx-full';
    root.setAttribute('data-design', 'lagen');
    expect(isGlowActive()).toBe(false);
  });
});

describe('acquirePointerGlow', () => {
  it('läuft einmal für mehrere Nutzer und endet beim letzten', () => {
    const element = card(0, 0);
    const first = acquirePointerGlow();
    const second = acquirePointerGlow();

    move(element, 10, 10);
    expect(requested).toBe(1);
    flush();
    expect(element.style.getPropertyValue('--gx')).toBe('10px');

    first();
    first();
    move(element, 20, 20);
    flush();
    expect(element.style.getPropertyValue('--gx')).toBe('20px');

    second();
    expect(element.style.getPropertyValue('--gx')).toBe('');
    move(element, 30, 30);
    flush();
    expect(element.style.getPropertyValue('--gx')).toBe('');
  });
});

describe('usePointerGlow', () => {
  it('läuft in Atelier und endet beim Wechsel der Richtung', () => {
    const element = card(0, 0);
    const { unmount } = renderHook(() => usePointerGlow());

    move(element, 10, 10);
    flush();
    expect(element.style.getPropertyValue('--gx')).toBe('10px');

    act(() => applyDesign('lagen'));
    expect(element.style.getPropertyValue('--gx')).toBe('');
    move(element, 20, 20);
    flush();
    expect(element.style.getPropertyValue('--gx')).toBe('');

    act(() => applyDesign('atelier'));
    move(element, 30, 30);
    flush();
    expect(element.style.getPropertyValue('--gx')).toBe('30px');

    unmount();
    expect(element.style.getPropertyValue('--gx')).toBe('');
  });

  it('startet in einer anderen Richtung gar nicht', () => {
    root.setAttribute('data-design', 'raum');
    const element = card(0, 0);
    renderHook(() => usePointerGlow());

    move(element, 10, 10);
    flush();
    expect(requested).toBe(0);
  });
});
