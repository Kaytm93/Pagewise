import { useCallback, useEffect, useRef, useState } from 'react';

/** Wie nah am Ende die Ansicht sein muss, damit sie neuen Text mitverfolgt (in Pixeln, D-028). */
export const FOLLOW_DISTANCE = 160;

/** So weit muss ein Finger nach unten wandern, bis es als Hochscrollen gilt (Zittern beim Antippen zählt nicht). */
const TOUCH_SLOP = 6;

/** Schwankungen der Position bis zu dieser Größe sind kein Scrollen (Rundung bei Zoom und DPR, in Pixeln). */
const JITTER = 2;

/** So lange nach einer Taste zum Hochscrollen (Pfeil hoch, Bild auf, Pos1, Umschalt + Leertaste) zählt eine Abnahme der Position als die der Person (ms). */
const KEY_WINDOW = 600;

/** Zwei ungeklärte Abnahmen der Position innerhalb dieser Zeit gelten als Ziehen an der Scrollleiste (ms). */
const DRAG_WINDOW = 400;

/** Ein Feld, in dem die Pfeiltasten den Cursor bewegen und nicht die Seite. */
function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

/** Eine Taste, die die Seite nach oben scrollt. */
function scrollsUp(event: KeyboardEvent): boolean {
  return (
    event.key === 'ArrowUp' ||
    event.key === 'PageUp' ||
    event.key === 'Home' ||
    (event.key === ' ' && event.shiftKey)
  );
}

function distanceToEnd(element: Element): number {
  return element.scrollHeight - element.scrollTop - element.clientHeight;
}

/** Scrollt das Ziel selbst nach oben (Code-Block, Eingabefeld)? Dann bewegt die Geste nicht die Seite. */
function scrollsInside(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body && node !== document.documentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
      if (node.scrollTop > 0) return true;
    }
    node = node.parentElement;
  }
  return false;
}

/** Weiches Scrollen nur bei „Voll“; bei „Reduziert“ und „Aus“ (und solange die Stufe noch fehlt) springt die Ansicht. */
function mayScrollSmoothly(): boolean {
  return document.documentElement.classList.contains('fx-full');
}

/**
 * Mitlesen (D-028, D-115, D-118): Die Ansicht folgt dem neuen Text und dem, was nachträglich wächst (Formeln,
 * Graphen, Moleküle laden nach). Wer hochgescrollt hat, bleibt dort. Wieder eingerastet wird, sobald man zurück
 * näher als 160 px ans Ende kommt, eine Nachricht sendet oder `toEnd()` aufruft („Zum Ende“-Knopf).
 *
 * Drei Fallen, die der alte Ansatz („bei jedem Scroll-Ereignis den Abstand zum Ende messen“) nicht kannte:
 * - Das Scroll-Ereignis kommt erst im nächsten Bild an. Ist die Seite bis dahin durch einen nachgeladenen
 *   Block gewachsen, sah es einen großen Abstand und löste das Mitlesen für immer (F-016). Jetzt zählt die
 *   Richtung: Ein Ereignis, das nur das eigene Hinscrollen meldet (die Position ging nicht nach oben), ändert
 *   nichts.
 * - Scrollt die Person hoch, holte der nächste Textabschnitt sie zurück, solange sie weniger als 160 px
 *   hochgekommen war (F-019). Das trifft jedes weiche Scrollen (Mausrad in WebKit, Finger, Trägheit), denn es
 *   beginnt mit wenigen Pixeln; das eigene Scrollen bricht das der Person ab. Darum löst schon die Geste das
 *   Mitlesen: Mausrad nach oben, Finger nach unten.
 * - Wächst die Seite ohne neue Nachricht (Blöcke laden nach, KaTeX setzt Formeln), scrollte niemand mehr
 *   (F-016, F-023). Das erledigt ein Beobachter der Größe des Verlaufs.
 *
 * Tastatur und Scrollleiste (Pfeil hoch, Bild auf, Pos1, Ziehen an der Leiste) senden keine Geste. Hier zählt die
 * Position selbst: Nimmt `scrollTop` nach oben ab (mehr als 2 px), ohne dass der Hook gescrollt hat, war es die
 * Person. Das Scrollen des Hooks zählt nicht, denn er merkt sich die Position gleich danach (`lastTop`); wächst die
 * Seite, ändert sich `scrollTop` nicht. Ab 160 px Abstand zum Ende löst eine Abnahme das Mitlesen sofort. Darunter
 * reicht die Position nicht: Klemmt der Browser sie, weil die Seite kürzer wurde (Platzhalter wird zu einem kleineren
 * Block), und wächst im selben Bild mehr nach, bleibt eine Abnahme mit kleinem Abstand zurück, die vom Hochscrollen
 * nicht zu unterscheiden ist (F-016: in WebKit blieb die Ansicht bei 6 von 60 Antworten mit Blöcken stehen). Dort
 * entscheidet darum ein Beleg: eine Taste zum Hochscrollen kurz davor (`keydown`), oder eine zweite solche Abnahme
 * innerhalb von 400 ms (die Leiste zieht weiter; ein einzelnes Klemmen kommt nicht gleich noch einmal). Die erste
 * Abnahme bleibt dann folgenlos, der nächste Text holt die Ansicht ans Ende zurück. Weitere Fälle, in denen die
 * Position von selbst sinkt:
 * - Wird die Seite kürzer als beim letzten Abgleich, klemmt der Browser sie auf das neue Ende (Abstand 0, oder
 *   wenige Pixel, wenn im selben Bild etwas nachwächst): kein Hochscrollen.
 * - iOS zieht die Ansicht über Anfang und Ende hinaus (Gummiband) und federt zurück; dabei sinkt die Position
 *   hinter dem Ende, und vor dem Anfang liegt sie unter 0. Beides löst nichts.
 *
 * `away` ist wahr, wenn das Mitlesen gelöst ist und das Ende weiter als 160 px entfernt liegt: dann zeigt die
 * Seite den „Zum Ende“-Knopf. Der Wert wird nur bei einem Wechsel gesetzt, nicht je Scroll-Ereignis.
 */
export function useFollowEnd() {
  const pinned = useRef(true);
  /** Letzte bekannte Scrollposition: nach eigenem Scrollen oder aus dem letzten Abgleich. */
  const lastTop = useRef(0);
  /** Höhe der Seite beim letzten Abgleich: Wurde sie kürzer, kann die Position nur geklemmt worden sein. */
  const lastHeight = useRef(0);
  /** Bis wann (performance.now) eine Taste zum Hochscrollen gedrückt gilt. */
  const keyUntil = useRef(0);
  /** Wann zuletzt eine Abnahme der Position ohne Taste und ohne Klärung beobachtet wurde. */
  const suspectAt = useRef(Number.NEGATIVE_INFINITY);
  const awayRef = useRef(false);
  const [away, setAway] = useState(false);

  /** Setzt `away` neu, aber nur, wenn es sich ändert. */
  const publish = useCallback((element: Element) => {
    const next = !pinned.current && distanceToEnd(element) > FOLLOW_DISTANCE;
    if (next === awayRef.current) return;
    awayRef.current = next;
    setAway(next);
  }, []);

  /**
   * Gleicht den Zustand mit der tatsächlichen Position ab: nach oben (und nicht nur geklemmt) löst das Mitlesen,
   * nach unten und nah am Ende rastet es ein. Wächst nur die Seite, bleibt die Position gleich und nichts ändert sich.
   */
  const settle = useCallback(
    (element: Element) => {
      const top = element.scrollTop;
      const height = element.scrollHeight;
      const distance = distanceToEnd(element);
      // Gummiband (iOS): über Anfang oder Ende hinausgezogen. Die Position gilt dann nicht als Messwert, und
      // `lastTop` bleibt, wo es war: Das Zurückfedern ist dann keine Abnahme.
      const overscrolled = top < 0 || distance < 0;
      if (!overscrolled) {
        if (top < lastTop.current - JITTER) {
          if (distance >= FOLLOW_DISTANCE) {
            pinned.current = false;
          } else if (distance > JITTER && !(height < lastHeight.current)) {
            // Unter 160 px sagt die Position allein nicht, wer gescrollt hat: Klemmt der Browser die Position, weil
            // die Seite kurz kürzer wurde, und wächst im selben Bild mehr nach (gemessen: WebKit, 6 von 60 Antworten
            // mit Blöcken), sieht das wie Hochscrollen aus. Als Person gilt es mit einer Taste davor oder bei der
            // zweiten solchen Abnahme kurz danach (Ziehen an der Leiste).
            const now = performance.now();
            if (now < keyUntil.current || now - suspectAt.current < DRAG_WINDOW)
              pinned.current = false;
            else suspectAt.current = now;
          }
          lastTop.current = top;
        } else if (top > lastTop.current + 1) {
          if (distance < FOLLOW_DISTANCE) pinned.current = true;
          lastTop.current = top;
        }
        // Dazwischen liegt nur Rauschen: `lastTop` bleibt, damit langsames Ziehen an der Leiste sich aufsummiert.
      }
      lastHeight.current = height;
      publish(element);
    },
    [publish],
  );

  /** Merkt sich, wo der Hook die Ansicht hingestellt hat, damit das folgende Scroll-Ereignis nicht als Person zählt. */
  const remember = useCallback((element: Element) => {
    lastTop.current = element.scrollTop;
    lastHeight.current = element.scrollHeight;
  }, []);

  /** Scrollt ans Ende, falls die Ansicht dem Text folgen soll. */
  const follow = useCallback(() => {
    const element = document.scrollingElement;
    if (!element) return;
    settle(element);
    if (pinned.current) {
      element.scrollTop = element.scrollHeight;
      remember(element);
    }
  }, [settle, remember]);

  /** Die Person hat gesendet: ab jetzt wieder am Ende bleiben. */
  const pin = useCallback(() => {
    pinned.current = true;
    const element = document.scrollingElement;
    if (element) {
      lastTop.current = element.scrollTop;
      publish(element);
    }
  }, [publish]);

  /** „Zum Ende“: ans Ende scrollen und das Mitlesen wieder aufnehmen. Weich nur bei „Voll“. */
  const toEnd = useCallback(() => {
    const element = document.scrollingElement;
    pinned.current = true;
    if (!element) return;
    if (mayScrollSmoothly() && typeof element.scrollTo === 'function') {
      // Das Scroll-Ereignis der Fahrt zeigt nach unten; `lastTop` zieht es bis zum Ende mit.
      element.scrollTo({ top: element.scrollHeight - element.clientHeight, behavior: 'smooth' });
      lastHeight.current = element.scrollHeight;
    } else {
      element.scrollTop = element.scrollHeight;
      remember(element);
    }
    publish(element);
  }, [publish, remember]);

  useEffect(() => {
    let touchStart: number | null = null;
    /** Die Person hat per Geste hochgescrollt: Mitlesen lösen, noch bevor sich die Seite bewegt hat. */
    const release = () => {
      pinned.current = false;
      const element = document.scrollingElement;
      if (element) publish(element);
    };
    const onScroll = () => {
      const element = document.scrollingElement;
      if (element) settle(element);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && !event.ctrlKey && !scrollsInside(event.target)) release();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditable(event.target) || !scrollsUp(event)) return;
      keyUntil.current = performance.now() + KEY_WINDOW;
    };
    const onTouchStart = (event: TouchEvent) => {
      touchStart = event.touches.length === 1 ? (event.touches[0]?.clientY ?? null) : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (touchStart === null || event.touches.length !== 1 || y === undefined) return;
      if (y - touchStart > TOUCH_SLOP && !scrollsInside(event.target)) release();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, [settle, publish]);

  /** Ref-Funktion: beobachtet die Größe des Elements und folgt, wenn sie sich ändert. */
  const watch = useCallback(
    (element: HTMLElement | null) => {
      if (!element || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => follow());
      observer.observe(element);
      return () => observer.disconnect();
    },
    [follow],
  );

  return { follow, pin, toEnd, away, watch };
}
