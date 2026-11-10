import { useCallback, useEffect, useRef } from 'react';

/** Wie nah am Ende die Ansicht sein muss, damit sie neuen Text mitverfolgt (in Pixeln, D-028). */
export const FOLLOW_DISTANCE = 160;

/** So weit muss ein Finger nach unten wandern, bis es als Hochscrollen gilt (Zittern beim Antippen zählt nicht). */
const TOUCH_SLOP = 6;

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

/**
 * Mitlesen (D-028, D-115): Die Ansicht folgt dem neuen Text und dem, was nachträglich wächst (Formeln, Graphen,
 * Moleküle laden nach). Wer hochgescrollt hat, bleibt dort. Wieder eingerastet wird, sobald man zurück näher
 * als 160 px ans Ende kommt oder eine Nachricht sendet.
 *
 * Drei Fallen, die der alte Ansatz („bei jedem Scroll-Ereignis den Abstand zum Ende messen“) nicht kannte:
 * - Das Scroll-Ereignis kommt erst im nächsten Bild an. Ist die Seite bis dahin durch einen nachgeladenen
 *   Block gewachsen, sah es einen großen Abstand und löste das Mitlesen für immer (F-016). Jetzt zählt die
 *   Richtung: Ein Ereignis, das nur das eigene Hinscrollen meldet (die Position ging nicht nach oben), ändert
 *   nichts. Ein Bildlauf nach oben löst das Mitlesen nur, wenn die Ansicht danach 160 px oder mehr vom Ende
 *   steht; kürzere Wege können vom Klemmen der Position kommen, wenn die Seite kürzer wird (Platzhalter wird zu
 *   einem kleineren Block).
 * - Scrollt die Person hoch, holte der nächste Textabschnitt sie zurück, solange sie weniger als 160 px
 *   hochgekommen war (F-019). Das trifft jedes weiche Scrollen (Mausrad in WebKit, Finger, Trägheit), denn es
 *   beginnt mit wenigen Pixeln; das eigene Scrollen bricht das der Person ab. Darum löst schon die Geste das
 *   Mitlesen: Mausrad nach oben, Finger nach unten (Tastatur und Scrollleiste laufen über den Weg oben).
 * - Wächst die Seite ohne neue Nachricht (Blöcke laden nach, KaTeX setzt Formeln), scrollte niemand mehr
 *   (F-016, F-023). Das erledigt ein Beobachter der Größe des Verlaufs.
 */
export function useFollowEnd() {
  const pinned = useRef(true);
  /** Letzte bekannte Scrollposition: nach eigenem Scrollen oder aus dem letzten Scroll-Ereignis. */
  const lastTop = useRef(0);

  /**
   * Gleicht den Zustand mit der tatsächlichen Position ab: nach oben und weit vom Ende löst das Mitlesen, nach
   * unten und nah am Ende rastet es ein. Wächst nur die Seite, bleibt die Position gleich und nichts ändert sich.
   */
  const settle = useCallback((element: Element) => {
    const top = element.scrollTop;
    const distance = distanceToEnd(element);
    if (top < lastTop.current - 1) {
      if (distance >= FOLLOW_DISTANCE) pinned.current = false;
    } else if (top > lastTop.current + 1 && distance < FOLLOW_DISTANCE) {
      pinned.current = true;
    }
    lastTop.current = top;
  }, []);

  /** Scrollt ans Ende, falls die Ansicht dem Text folgen soll. */
  const follow = useCallback(() => {
    const element = document.scrollingElement;
    if (!element) return;
    settle(element);
    if (pinned.current) {
      element.scrollTop = element.scrollHeight;
      lastTop.current = element.scrollTop;
    }
  }, [settle]);

  /** Die Person hat gesendet: ab jetzt wieder am Ende bleiben. */
  const pin = useCallback(() => {
    pinned.current = true;
    const element = document.scrollingElement;
    if (element) lastTop.current = element.scrollTop;
  }, []);

  useEffect(() => {
    let touchStart: number | null = null;
    const onScroll = () => {
      const element = document.scrollingElement;
      if (element) settle(element);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && !event.ctrlKey && !scrollsInside(event.target))
        pinned.current = false;
    };
    const onTouchStart = (event: TouchEvent) => {
      touchStart = event.touches.length === 1 ? (event.touches[0]?.clientY ?? null) : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (touchStart === null || event.touches.length !== 1 || y === undefined) return;
      if (y - touchStart > TOUCH_SLOP && !scrollsInside(event.target)) pinned.current = false;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, [settle]);

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

  return { follow, pin, watch };
}
