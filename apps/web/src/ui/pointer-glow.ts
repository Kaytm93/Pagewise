import { useEffect } from 'react';
import { useDesign } from './useDesign';

/**
 * Zeigerlicht in der Richtung „Atelier“ (D-045): ein weicher Schein in der Fachfarbe folgt dem Zeiger in der
 * Seitenleiste, auf Karten, Zeilen und am Rand von Kacheln.
 *
 * Das Skript setzt nur zwei Längen (`--gx`, `--gy`, in Pixeln vom Rand des Elements) über das CSSOM auf das
 * Element unter dem Zeiger; Aussehen und Bewegung des Scheins stehen in `styles/atelier.css` (Schein per
 * `transform`, Überblendung per `opacity`). Es läuft nur,
 *   - in der Richtung „Atelier“,
 *   - in der Effektstufe „Voll“ (`fx-full`),
 *   - mit Maus oder Stift (`(hover: hover) and (pointer: fine)`, nie bei Touch),
 *   - solange der Tab sichtbar ist (`tab-hidden` fehlt),
 * und höchstens einmal je Bildwiederholung (`requestAnimationFrame`).
 */

/** Elemente, die einen Schein tragen können (`atelier.css` malt ihn). */
export const GLOW_TARGETS = '.lg-binder, .lg-slip, .lg-row, .at-glow, .at-glow-edge';

const FINE_POINTER = '(hover: hover) and (pointer: fine)';

/** Gilt für die Seite gerade alles, was der Schein verlangt? (Zeigerart prüft der Aufrufer am Ereignis.) */
export function isGlowActive(root: HTMLElement = document.documentElement): boolean {
  return (
    root.getAttribute('data-design') === 'atelier' &&
    root.classList.contains('fx-full') &&
    !root.classList.contains('tab-hidden') &&
    document.visibilityState !== 'hidden'
  );
}

/** Startet die Verfolgung des Zeigers. Gibt eine Funktion zum Aufräumen zurück. */
export function startPointerGlow(): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const fine = window.matchMedia(FINE_POINTER);
  const touched = new Set<HTMLElement>();
  let frame = 0;
  let last: { target: EventTarget | null; x: number; y: number } | null = null;

  const clear = () => {
    for (const element of touched) {
      element.style.removeProperty('--gx');
      element.style.removeProperty('--gy');
    }
    touched.clear();
  };

  const paint = () => {
    frame = 0;
    const point = last;
    last = null;
    if (!point || !(point.target instanceof Element) || !isGlowActive()) return;
    const host = point.target.closest<HTMLElement>(GLOW_TARGETS);
    if (!host) return;
    const box = host.getBoundingClientRect();
    host.style.setProperty('--gx', `${Math.round(point.x - box.left)}px`);
    host.style.setProperty('--gy', `${Math.round(point.y - box.top)}px`);
    touched.add(host);
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || !fine.matches || !isGlowActive()) {
      last = null;
      if (touched.size > 0) clear();
      return;
    }
    last = { target: event.target, x: event.clientX, y: event.clientY };
    if (!frame) frame = window.requestAnimationFrame(paint);
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') clear();
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('pointermove', onMove);
    document.removeEventListener('visibilitychange', onVisibility);
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    last = null;
    clear();
  };
}

// Mehrere Bausteine dürfen das Zeigerlicht anfordern (Startseite, später die Hülle); es läuft einmal.
let users = 0;
let stop: (() => void) | null = null;

/** Fordert das Zeigerlicht an. Gibt eine Funktion zum Freigeben zurück; der letzte Nutzer schaltet es ab. */
export function acquirePointerGlow(): () => void {
  users += 1;
  if (users === 1) stop = startPointerGlow();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users -= 1;
    if (users === 0) {
      stop?.();
      stop = null;
    }
  };
}

/**
 * Schaltet das Zeigerlicht ein, solange die Richtung „Atelier“ gilt, und beim Wechsel der Richtung (oder beim
 * Verlassen des Bausteins) wieder aus. Die Bedingungen für Stufe, Zeigerart und Tab prüft das Skript selbst.
 */
export function usePointerGlow(): void {
  const active = useDesign() === 'atelier';
  useEffect(() => (active ? acquirePointerGlow() : undefined), [active]);
}
