import { describe, expect, it, vi } from 'vitest';
import { KEYBOARD_VAR, keyboardInset, startKeyboardInset } from './keyboard';

type Listener = () => void;

/** Ersatz für `window.visualViewport` und `<html>`. */
function setup(initial: { height: number; offsetTop?: number; scale?: number }, innerHeight = 800) {
  const listeners = new Map<string, Set<Listener>>();
  const viewport = {
    height: initial.height,
    offsetTop: initial.offsetTop ?? 0,
    scale: initial.scale ?? 1,
    addEventListener: (type: string, listener: Listener) => {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: Listener) =>
      listeners.get(type)?.delete(listener),
  };
  const properties = new Map<string, string>();
  const root = {
    style: {
      setProperty: vi.fn((name: string, value: string) => properties.set(name, value)),
      removeProperty: vi.fn((name: string) => {
        properties.delete(name);
        return '';
      }),
    },
  };
  const env = { visualViewport: viewport, innerHeight, root } as unknown as Parameters<
    typeof startKeyboardInset
  >[0];
  const fire = (type: 'resize' | 'scroll') => {
    for (const listener of listeners.get(type) ?? []) listener();
  };
  return { viewport, root, properties, env, fire, listeners };
}

describe('Tastaturhöhe', () => {
  it('rechnet die Höhe aus Seite, Ausschnitt und Verschiebung', () => {
    expect(keyboardInset(800, { height: 800, offsetTop: 0, scale: 1 })).toBe(0);
    expect(keyboardInset(800, { height: 480, offsetTop: 0, scale: 1 })).toBe(320);
    // Der Ausschnitt ist ganz nach unten gerutscht: Die Eingabezeile sitzt schon richtig.
    expect(keyboardInset(800, { height: 480, offsetTop: 320, scale: 1 })).toBe(0);
    expect(keyboardInset(800, { height: 480, offsetTop: 100, scale: 1 })).toBe(220);
  });

  it('hält Browser-Leisten und das Heranzoomen nicht für eine Tastatur', () => {
    expect(keyboardInset(800, { height: 780, offsetTop: 0, scale: 1 })).toBe(0);
    expect(keyboardInset(800, { height: 400, offsetTop: 0, scale: 2 })).toBe(0);
    expect(keyboardInset(800, { height: 400, offsetTop: 0, scale: 0.5 })).toBe(0);
  });
});

describe('startKeyboardInset', () => {
  it('setzt --kb über das CSSOM, wenn die Tastatur erscheint, und entfernt sie wieder', () => {
    const t = setup({ height: 800 });
    startKeyboardInset(t.env);
    expect(t.properties.has(KEYBOARD_VAR)).toBe(false);

    t.viewport.height = 470;
    t.fire('resize');
    expect(t.root.style.setProperty).toHaveBeenCalledWith('--kb', '330px');

    t.viewport.height = 800;
    t.fire('resize');
    expect(t.properties.has(KEYBOARD_VAR)).toBe(false);
  });

  it('folgt dem Verschieben des Ausschnitts (scroll) und schreibt nur bei Änderung', () => {
    const t = setup({ height: 470 });
    startKeyboardInset(t.env);
    expect(t.root.style.setProperty).toHaveBeenCalledTimes(1);
    t.fire('scroll');
    t.fire('scroll');
    expect(t.root.style.setProperty).toHaveBeenCalledTimes(1);
    t.viewport.offsetTop = 120;
    t.fire('scroll');
    expect(t.properties.get('--kb')).toBe('210px');
  });

  it('hängt sich beim Beenden ab und räumt die Variable weg', () => {
    const t = setup({ height: 470 });
    const stop = startKeyboardInset(t.env);
    expect(t.properties.get('--kb')).toBe('330px');
    stop();
    expect(t.properties.has('--kb')).toBe(false);
    expect([...t.listeners.values()].every((set) => set.size === 0)).toBe(true);
    t.viewport.height = 300;
    t.fire('resize');
    expect(t.properties.has('--kb')).toBe(false);
  });

  it('tut ohne visualViewport nichts', () => {
    const t = setup({ height: 800 });
    const stop = startKeyboardInset({
      visualViewport: undefined,
      innerHeight: 800,
      root: t.root as unknown as HTMLElement,
    });
    expect(typeof stop).toBe('function');
    stop();
    expect(t.root.style.setProperty).not.toHaveBeenCalled();
  });
});
