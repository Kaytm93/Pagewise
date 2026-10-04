/**
 * Parallaxe des Fensterlichts in der Richtung „Raum“ (D-045): das Lichtfeld folgt dem Zeiger ein wenig.
 *
 * Nur mit Maus oder Stift (`(hover: hover) and (pointer: fine)`), nur in der Effektstufe „Voll“ und nur, solange
 * der Tab sichtbar ist. Auf Touch-Geräten (iPad ohne Maus) läuft nichts. Gesetzt werden zwei Zahlen (`--px`,
 * `--py`, -1 bis 1) über das CSSOM auf das Zielelement; die Bewegung selbst ist reines CSS (transform).
 */
const clamp = (value: number) => Math.min(1, Math.max(-1, value));

export function isParallaxActive(root: HTMLElement = document.documentElement): boolean {
  return (
    root.getAttribute('data-design') === 'raum' &&
    root.classList.contains('fx-full') &&
    !root.classList.contains('tab-hidden')
  );
}

/** Startet die Verfolgung des Zeigers. Gibt eine Funktion zum Aufräumen zurück. */
export function startParallax(target: HTMLElement): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  let frame = 0;
  let last: { x: number; y: number } | null = null;

  const reset = () => {
    target.style.setProperty('--px', '0');
    target.style.setProperty('--py', '0');
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || !fine.matches || !isParallaxActive()) {
      if (last) {
        last = null;
        reset();
      }
      return;
    }
    last = { x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (!last) return;
      target.style.setProperty('--px', clamp((last.x / window.innerWidth) * 2 - 1).toFixed(3));
      target.style.setProperty('--py', clamp((last.y / window.innerHeight) * 2 - 1).toFixed(3));
    });
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  return () => {
    window.removeEventListener('pointermove', onMove);
    if (frame) window.cancelAnimationFrame(frame);
    reset();
  };
}
