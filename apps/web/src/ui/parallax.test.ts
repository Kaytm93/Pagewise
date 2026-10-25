// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isParallaxActive, startParallax } from './parallax';

/* Parallaxe in „Raum“: zwei Zahlen am Ziel, geglättet per rAF, nur Maus/Stift, „Voll“, sichtbarer Tab. */

let frames: Array<() => void> = [];
let fine = true;
let stop: (() => void) | undefined;
let target: HTMLElement;

function flush(count = 1) {
  for (let i = 0; i < count; i += 1) {
    const batch = frames;
    frames = [];
    for (const run of batch) run();
  }
}

function move(clientX: number, clientY: number, pointerType = 'mouse') {
  window.dispatchEvent(
    Object.assign(new MouseEvent('pointermove', { clientX, clientY }), { pointerType }),
  );
}

const value = (name: string) => Number(target.style.getPropertyValue(name));

beforeEach(() => {
  frames = [];
  fine = true;
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => frames.push(run));
  vi.stubGlobal('cancelAnimationFrame', () => {
    frames = [];
  });
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return fine;
    },
  }));
  const root = document.documentElement;
  root.setAttribute('data-design', 'raum');
  root.className = 'fx-full';
  target = document.createElement('div');
  target.dataset.view = 'home';
  document.body.append(target);
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  stop = startParallax(target);
});

afterEach(() => {
  stop?.();
  target.remove();
  document.documentElement.removeAttribute('data-design');
  document.documentElement.className = '';
  vi.unstubAllGlobals();
});

describe('isParallaxActive', () => {
  it('gilt nur in Raum, bei „Voll“ und sichtbarem Tab', () => {
    const root = document.documentElement;
    expect(isParallaxActive()).toBe(true);
    root.classList.add('tab-hidden');
    expect(isParallaxActive()).toBe(false);
    root.classList.remove('tab-hidden');
    root.className = 'fx-reduced';
    expect(isParallaxActive()).toBe(false);
    root.className = 'fx-full';
    root.setAttribute('data-design', 'lagen');
    expect(isParallaxActive()).toBe(false);
  });
});

describe('startParallax', () => {
  it('nähert sich dem Ziel in kleinen Schritten an (Lerp) und endet dort', () => {
    move(1000, 800);
    expect(target.hasAttribute('data-parallax')).toBe(true);
    flush();
    const first = value('--px');
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.2);
    flush();
    expect(value('--px')).toBeGreaterThan(first);
    flush(120);
    expect(value('--px')).toBe(1);
    expect(value('--py')).toBe(1);
    // Angekommen: kein weiterer Lauf, will-change-Merker weg
    expect(frames).toHaveLength(0);
    expect(target.hasAttribute('data-parallax')).toBe(false);
  });

  it('ignoriert Touch', () => {
    move(1000, 800, 'touch');
    flush(5);
    expect(target.style.getPropertyValue('--px')).toBe('');
    expect(target.hasAttribute('data-parallax')).toBe(false);
  });

  it('ignoriert Zeiger ohne feines Zeigegerät', () => {
    fine = false;
    move(1000, 800);
    expect(frames).toHaveLength(0);
  });

  it('nimmt auch einen Stift an', () => {
    move(0, 0, 'pen');
    flush(120);
    expect(value('--px')).toBe(-1);
  });

  it('bewegt nichts bei „Reduziert“ und im Hintergrund-Tab', () => {
    document.documentElement.className = 'fx-reduced';
    move(1000, 800);
    expect(frames).toHaveLength(0);
    document.documentElement.className = 'fx-full tab-hidden';
    move(1000, 800);
    expect(frames).toHaveLength(0);
  });

  it('bewegt nichts im Chat', () => {
    target.dataset.view = 'chat';
    move(1000, 800);
    expect(frames).toHaveLength(0);
    target.dataset.view = 'default-chat';
    move(1000, 800);
    expect(frames).toHaveLength(0);
  });

  it('kehrt sanft zur Mitte zurück, wenn die Stufe während der Fahrt abgeschaltet wird', () => {
    move(1000, 800);
    flush(120);
    expect(value('--px')).toBe(1);
    document.documentElement.className = 'fx-off';
    move(900, 700);
    flush();
    expect(value('--px')).toBeLessThan(1);
    expect(value('--px')).toBeGreaterThan(0);
    flush(120);
    expect(value('--px')).toBe(0);
  });

  it('kehrt zur Mitte zurück, wenn der Zeiger das Fenster verlässt', () => {
    move(1000, 800);
    flush(120);
    document.documentElement.dispatchEvent(new Event('pointerleave'));
    flush(120);
    expect(value('--px')).toBe(0);
    expect(value('--py')).toBe(0);
  });

  it('räumt auf: Ziel zurückgesetzt, kein Merker, Zeigerereignisse entfernt', () => {
    move(1000, 800);
    flush(3);
    stop?.();
    expect(value('--px')).toBe(0);
    expect(target.hasAttribute('data-parallax')).toBe(false);
    move(0, 0);
    expect(frames).toHaveLength(0);
  });
});
