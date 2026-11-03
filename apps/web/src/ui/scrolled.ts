/**
 * Scroll-Zustand des Kopfes der schmalen Breite (AppShell, Klasse `lg-mobilkopf`, D-076).
 *
 * Sobald die Seite um mehr als ein paar Pixel gescrollt ist, steht am Kopf das Attribut `data-scrolled`; steht
 * die Seite wieder oben, wird es entfernt. Die Richtungen hängen ihre Fläche daran: „Lagen“ legt dann seine
 * deckende Fläche unter den Kopf (lagen.css), „Atelier“ legt sein Glas darunter (atelier.css). Das Attribut selbst gestaltet nichts.
 *
 * Gelesen wird `window.scrollY`: In der App scrollt immer das Dokument (die Seitenhülle hat keinen eigenen
 * Scroll-Container; Chat und Stundenplan scrollen mit der Seite). Beim Gummiband-Überzug oberhalb von 0 (iOS) ist
 * der Wert negativ und der Zustand bleibt „nicht gescrollt“. Der Scroll-Listener ist passiv und schreibt nur, wenn
 * sich der Zustand ändert (ein Attribut am Kopf, über `setAttribute`, nie über `style`). Das Dokument meldet das
 * Scrollen höchstens einmal je Bild, ein eigener rAF-Takt wäre darüber nur eine zweite Warteschlange.
 */

/** Name des Attributs am Kopf. */
export const SCROLLED_ATTRIBUTE = 'data-scrolled';

/** Ab dieser Scrollhöhe (in Pixeln, strikt größer) gilt die Seite als gescrollt. */
export const SCROLLED_THRESHOLD = 4;

/** Setzt und entfernt `data-scrolled` am Ziel. Gibt eine Funktion zum Aufräumen zurück. */
export function startScrolledState(
  target: HTMLElement,
  threshold: number = SCROLLED_THRESHOLD,
): () => void {
  const update = () => {
    const scrolled = window.scrollY > threshold;
    if (scrolled === target.hasAttribute(SCROLLED_ATTRIBUTE)) return;
    if (scrolled) target.setAttribute(SCROLLED_ATTRIBUTE, '');
    else target.removeAttribute(SCROLLED_ATTRIBUTE);
  };

  // Eine wiederhergestellte Scrollhöhe (Neuladen, Zurück) gilt schon vor dem ersten Scroll-Ereignis.
  update();
  window.addEventListener('scroll', update, { passive: true });
  return () => {
    window.removeEventListener('scroll', update);
    target.removeAttribute(SCROLLED_ATTRIBUTE);
  };
}
