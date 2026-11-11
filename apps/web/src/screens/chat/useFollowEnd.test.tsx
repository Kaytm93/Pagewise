// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOLLOW_DISTANCE, useFollowEnd } from './useFollowEnd';

/**
 * Der Hook für das Mitlesen (D-028, D-115, D-118) ohne Chat-Seite: jsdom misst kein Layout, darum steht
 * `document.scrollingElement` als Ersatz-Seite da, die wie ein Browser rechnet (`scrollTop` wird beim Setzen auf
 * das Ende begrenzt). `force` schreibt die Position roh, so wie das Gummiband von iOS die Ansicht über Anfang
 * und Ende hinauszieht, und `scroll()` löst das Ereignis aus, das im Browser erst im nächsten Bild kommt.
 */

class Page {
  scrollHeight = 2000;
  clientHeight = 800;
  private top = 0;
  readonly scrollTo = vi.fn((options: ScrollToOptions) => {
    this.top = Math.max(0, Math.min(options.top ?? 0, this.end));
  });
  get scrollTop(): number {
    return this.top;
  }
  set scrollTop(value: number) {
    this.top = Math.max(0, Math.min(value, this.end));
  }
  get end(): number {
    return this.scrollHeight - this.clientHeight;
  }
  /** Position roh setzen (Gummiband, oder die Person scrollt, ohne dass der Browser schon ein Ereignis gemeldet hat). */
  force(value: number): void {
    this.top = value;
  }
  /** Die Seite wird kürzer: der Browser klemmt die Position von selbst auf das neue Ende. */
  shrink(height: number): void {
    this.scrollHeight = height;
    this.top = Math.min(this.top, this.end);
  }
}

let page: Page;
/** Die Uhr des Hooks (`performance.now`), damit die Zeitfenster der Tests nicht vom Rechner abhängen. */
let clock = 0;
/** Eine Taste, wie sie auf der Seite ankommt (Ziel: der Körper, also kein Eingabefeld). */
const press = (key: string, options: KeyboardEventInit = {}, target: Element = document.body) =>
  act(
    () =>
      void target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options })),
  );
const scroll = () => act(() => void window.dispatchEvent(new Event('scroll')));
const wheel = (deltaY: number) =>
  act(() => void window.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true })));

/** Hook, dessen Ansicht beim Start am Ende steht und dort angekommen ist (`follow` einmal gelaufen). */
function atEnd() {
  const hook = renderHook(() => useFollowEnd());
  page.scrollTop = page.end;
  act(() => hook.result.current.follow());
  expect(page.scrollTop).toBe(page.end);
  return hook;
}

beforeEach(() => {
  clock = 10_000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  page = new Page();
  Object.defineProperty(document, 'scrollingElement', { configurable: true, value: page });
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'scrollingElement');
  document.documentElement.className = '';
});

describe('useFollowEnd: Hochscrollen ohne Geste (Tastatur, Scrollleiste)', () => {
  it('löst das Mitlesen, wenn die Position nach oben abnimmt (Pfeil hoch, 40 px), schon unter 160 px', () => {
    const { result } = atEnd();
    press('ArrowUp');
    page.force(page.end - 40);
    scroll();
    page.scrollHeight = 2300;
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(page.end - 340);
  });

  it('löst es auch, wenn das Ereignis noch fehlt und der nächste Text zuerst kommt', () => {
    const { result } = atEnd();
    press('ArrowUp');
    page.force(page.end - 30);
    page.scrollHeight = 2100;
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(1170);
  });

  it('löst es bei einem Sprung von Bild auf und bei Pos1 (ab 160 px braucht es keine Taste als Beleg)', () => {
    const { result } = atEnd();
    page.force(page.end - 700);
    scroll();
    page.scrollHeight = 2400;
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(500);
    expect(result.current.away).toBe(true);
  });

  it('zählt langsames Ziehen an der Scrollleiste zusammen (je 1 px, wie ein Zug über viele Bilder, ohne Taste)', () => {
    const { result } = atEnd();
    for (let step = 1; step <= 30; step++) {
      clock += 16;
      page.force(page.end - step);
      scroll();
    }
    page.scrollHeight = 2200;
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(1170);
  });

  it('ignoriert Schwankungen bis 2 px (Rundung bei Zoom und DPR)', () => {
    const { result } = atEnd();
    for (const jitter of [1, 2, 1, 2, 0, 2]) {
      page.force(page.end - jitter);
      scroll();
    }
    page.scrollHeight = 2100;
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(page.end);
  });

  it('zählt das eigene Scrollen des Hooks nicht: Textstücke wachsen, es folgt, das Ereignis ändert nichts', () => {
    const { result } = atEnd();
    for (let size = 2100; size <= 2500; size += 100) {
      page.scrollHeight = size;
      act(() => result.current.follow());
      scroll();
      expect(page.scrollTop).toBe(page.end);
    }
    expect(result.current.away).toBe(false);
  });

  it('wächst die Seite, ohne dass die Person scrollt, bleibt das Mitlesen (Position sinkt nicht)', () => {
    const { result } = atEnd();
    page.scrollHeight = 2900;
    scroll();
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(page.end);
  });
});

describe('useFollowEnd: unter 160 px entscheidet ein Beleg, nicht die Position allein (F-016, WebKit)', () => {
  /** Die Seite ist 1745 px hoch, die Ansicht steht am Ende, der Hook hat sie dort abgestellt. */
  function atEndOf1745() {
    page.scrollHeight = 1745;
    return atEnd();
  }

  it('eine einzelne Abnahme ohne Taste löst nichts: Klemmen und Nachwachsen im selben Bild, die Seite danach höher', () => {
    const { result } = atEndOf1745();
    // Ein Platzhalter wird kleiner (die Position klemmt auf 911), dazu wächst der Text: 1802 px, Position 911,
    // Abstand 91. Gemessen in Playwright-WebKit (Mac, Lagen) an 6 von 60 Antworten mit Blöcken.
    page.shrink(1711);
    page.scrollHeight = 1802;
    scroll();
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(page.end);
    expect(result.current.away).toBe(false);
  });

  it('auch mit dem Ereignis erst nach dem nächsten Textstück: bleibt am Ende', () => {
    const { result } = atEndOf1745();
    page.shrink(1711);
    page.scrollHeight = 1802;
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(page.end);
  });

  it('eine Taste zum Hochscrollen davor ist der Beleg (Pfeil hoch, Bild auf, Pos1, Umschalt + Leertaste)', () => {
    for (const [key, options] of [
      ['ArrowUp', {}],
      ['PageUp', {}],
      ['Home', {}],
      [' ', { shiftKey: true }],
    ] as const) {
      const { result, unmount } = atEnd();
      press(key, options);
      page.force(page.end - 40);
      scroll();
      page.scrollHeight += 100;
      act(() => result.current.follow());
      expect(page.scrollTop, key).toBe(page.end - 140);
      unmount();
      page.scrollHeight = 2000;
      clock += 5000;
    }
  });

  it('andere Tasten sind kein Beleg (Pfeil runter, Bild ab, Leertaste ohne Umschalt, Buchstaben)', () => {
    const { result } = atEnd();
    for (const key of ['ArrowDown', 'PageDown', 'End', ' ', 'a']) press(key);
    page.force(page.end - 40);
    scroll();
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(page.end);
  });

  it('eine Taste in einem Eingabefeld ist kein Beleg (dort bewegen die Pfeiltasten den Cursor)', () => {
    const { result } = atEnd();
    const field = document.createElement('textarea');
    document.body.append(field);
    press('ArrowUp', {}, field);
    field.remove();
    page.force(page.end - 40);
    scroll();
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(page.end);
  });

  it('der Beleg gilt 600 ms', () => {
    const { result } = atEnd();
    press('ArrowUp');
    clock += 700;
    page.force(page.end - 40);
    scroll();
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(page.end);
  });

  it('zwei Abnahmen innerhalb von 400 ms (das Ziehen an der Leiste geht weiter) lösen das Mitlesen', () => {
    const { result } = atEnd();
    page.force(page.end - 50);
    scroll();
    // Die erste Abnahme bleibt folgenlos, der nächste Text holt die Ansicht ans Ende zurück.
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(page.end);
    // Die Leiste steht weiter oben, das Ziehen setzt sich fort.
    clock += 120;
    page.force(page.end - 60);
    scroll();
    page.scrollHeight = 2200;
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(1200 - 60);
  });

  it('zwei Abnahmen mit mehr als 400 ms Abstand sind zwei einzelne Klemmfälle, kein Hochscrollen', () => {
    const { result } = atEnd();
    page.force(page.end - 50);
    scroll();
    act(() => result.current.follow());
    clock += 500;
    page.force(page.end - 60);
    scroll();
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(page.end);
  });
});

describe('useFollowEnd: Klemmen und Gummiband lösen nichts', () => {
  it('Seite wird kürzer, die Position wird geklemmt: bleibt am Ende', () => {
    const { result } = atEnd();
    page.shrink(1500);
    scroll();
    page.scrollHeight = 1900;
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(page.end);
  });

  it('Seite wird kürzer und im selben Bild wächst ein Stück nach: kein Hochscrollen', () => {
    const { result } = atEnd();
    page.shrink(1840);
    page.scrollHeight = 1863;
    scroll();
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(page.end);
  });

  it('Gummiband oben bei einem kurzen Chat: nach unten gezogen (negative Position) und zurück', () => {
    page.scrollHeight = 800;
    const { result } = renderHook(() => useFollowEnd());
    act(() => result.current.follow());
    page.force(-30);
    scroll();
    page.force(0);
    scroll();
    page.scrollHeight = 1500;
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(page.end);
    expect(result.current.away).toBe(false);
  });

  it('Gummiband unten: über das Ende gezogen und zurückgefedert (Abstand negativ, dann 0)', () => {
    const { result } = atEnd();
    page.force(page.end + 40);
    scroll();
    expect(result.current.away).toBe(false);
    page.force(page.end);
    scroll();
    page.scrollHeight = 2200;
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(page.end);
    expect(result.current.away).toBe(false);
  });

  it('Gummiband unten, und die Seite wächst währenddessen: bleibt am Ende', () => {
    const { result } = atEnd();
    page.force(page.end + 40);
    scroll();
    page.scrollHeight = 2100;
    scroll();
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(page.end);
  });
});

describe('useFollowEnd: away', () => {
  it('ist falsch am Ende und bei kurzem Hochscrollen (bis 160 px), wahr darüber', () => {
    const { result } = atEnd();
    expect(result.current.away).toBe(false);
    page.force(page.end - FOLLOW_DISTANCE);
    scroll();
    expect(result.current.away).toBe(false);
    page.force(page.end - FOLLOW_DISTANCE - 1);
    scroll();
    expect(result.current.away).toBe(true);
  });

  it('wird wahr, wenn nach einer Geste nach oben die Seite weiterwächst und das Ende weit weg liegt', () => {
    const { result } = atEnd();
    wheel(-90);
    expect(result.current.away).toBe(false);
    page.scrollHeight = 2400;
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(1200);
    expect(result.current.away).toBe(true);
  });

  it('wird wieder falsch, wenn die Person zurück nah ans Ende scrollt', () => {
    const { result } = atEnd();
    page.force(300);
    scroll();
    expect(result.current.away).toBe(true);
    page.force(page.end - 100);
    scroll();
    expect(result.current.away).toBe(false);
    page.scrollHeight = 2600;
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(page.end);
  });

  it('wird beim Senden (pin) falsch', () => {
    const { result } = atEnd();
    page.force(300);
    scroll();
    expect(result.current.away).toBe(true);
    act(() => result.current.pin());
    expect(result.current.away).toBe(false);
  });

  it('wird nur bei einem Wechsel gesetzt: viele Ereignisse ohne Wechsel rendern nicht neu', () => {
    let renders = 0;
    const hook = renderHook(() => {
      renders += 1;
      return useFollowEnd();
    });
    page.scrollTop = page.end;
    act(() => hook.result.current.follow());
    const vorher = renders;
    for (let i = 0; i < 20; i++) {
      page.scrollHeight += 50;
      act(() => hook.result.current.follow());
      scroll();
    }
    expect(renders).toBe(vorher);
    page.force(100);
    scroll();
    const nachWechsel = renders;
    expect(nachWechsel).toBe(vorher + 1);
    for (let step = 0; step < 10; step++) {
      page.force(90 - step);
      scroll();
    }
    expect(renders).toBe(nachWechsel);
  });
});

describe('useFollowEnd: toEnd', () => {
  function awayFromEnd() {
    const hook = atEnd();
    page.force(300);
    scroll();
    expect(hook.result.current.away).toBe(true);
    return hook;
  }

  it('springt ans Ende und nimmt das Mitlesen auf (ohne Effektstufe „Voll“ weich zu scrollen)', () => {
    const { result } = awayFromEnd();
    act(() => result.current.toEnd());
    expect(page.scrollTo).not.toHaveBeenCalled();
    expect(page.scrollTop).toBe(page.end);
    expect(result.current.away).toBe(false);
    page.scrollHeight = 2400;
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(page.end);
  });

  it.each(['fx-reduced', 'fx-off'])('scrollt bei %s nicht weich', (level) => {
    document.documentElement.classList.add(level);
    const { result } = awayFromEnd();
    act(() => result.current.toEnd());
    expect(page.scrollTo).not.toHaveBeenCalled();
    expect(page.scrollTop).toBe(page.end);
  });

  it('scrollt bei „Voll“ weich ans Ende, blendet den Knopf sofort aus und nimmt das Mitlesen auf', () => {
    document.documentElement.classList.add('fx-full');
    const { result } = awayFromEnd();
    act(() => result.current.toEnd());
    expect(page.scrollTo).toHaveBeenCalledTimes(1);
    expect(page.scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: 'smooth' });
    expect(result.current.away).toBe(false);
    // Unterwegs kommt Text: das Mitlesen gilt schon, die Ansicht folgt.
    page.force(700);
    scroll();
    page.scrollHeight = 2400;
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(page.end);
  });

  it('wird von einer Geste nach oben während der Fahrt wieder gelöst', () => {
    document.documentElement.classList.add('fx-full');
    const { result } = awayFromEnd();
    act(() => result.current.toEnd());
    page.force(900);
    wheel(-120);
    page.scrollHeight = 2400;
    act(() => result.current.follow());
    expect(page.scrollTop).toBe(900);
    expect(result.current.away).toBe(true);
  });
});
