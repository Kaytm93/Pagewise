/**
 * Parallaxe des Fensterlichts in der Richtung „Raum“ (D-045): zwei Ebenen hinter dem Blatt folgen dem Zeiger ein
 * wenig, die Wand (`.lg-app::before`) schwach, das Fensterlicht (`.lg-app::after`) stärker und gegenläufig.
 *
 * Bedingungen, alle zugleich:
 * - nur Maus oder Stift (`(hover: hover) and (pointer: fine)`, Zeigerart nicht „touch“): ein iPad ohne Maus
 *   bewegt nichts;
 * - nur Effektstufe „Voll“ und Richtung „Raum“ (Klassen am <html>);
 * - nur bei sichtbarem Tab (`tab-hidden` fehlt);
 * - nicht im Chat: hinter dem Lesebereich wandert nichts.
 *
 * Geglättet: Der Zeiger setzt nur ein Ziel, ein rAF-Lauf nähert die Ebenen jedes Bild um einen festen Bruchteil
 * an (Lerp) und endet, sobald sie angekommen sind. Gesetzt werden zwei Zahlen (`--px`, `--py`, −1 bis 1) über das
 * CSSOM auf das Zielelement; die Bewegung selbst ist reines CSS (`transform`). Solange der Lauf geht, steht
 * `data-parallax` am Ziel: nur dann gibt raum.css den Ebenen ein `will-change`, nie dauerhaft. Das Heft selbst
 * neigt sich nicht (bewusst, D-045).
 */
const clamp = (value: number) => Math.min(1, Math.max(-1, value));

/** Anteil des Wegs, den die Ebenen je Bild zurücklegen (~ 0,3 s bis zur Ankunft bei 60 Bildern). */
const EASE = 0.1;
/** Näher als das gilt als angekommen. */
const REST = 0.002;

const CHAT_VIEWS = new Set(['chat', 'default-chat']);

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
  const goal = { x: 0, y: 0 };
  const pos = { x: 0, y: 0 };

  const allowed = () =>
    fine.matches && isParallaxActive() && !CHAT_VIEWS.has(target.dataset.view ?? '');

  const write = () => {
    target.style.setProperty('--px', pos.x.toFixed(3));
    target.style.setProperty('--py', pos.y.toFixed(3));
  };

  const tick = () => {
    frame = 0;
    if (!allowed()) {
      goal.x = 0;
      goal.y = 0;
    }
    pos.x += (goal.x - pos.x) * EASE;
    pos.y += (goal.y - pos.y) * EASE;
    const arrived = Math.abs(goal.x - pos.x) < REST && Math.abs(goal.y - pos.y) < REST;
    if (arrived) {
      pos.x = goal.x;
      pos.y = goal.y;
    }
    write();
    if (arrived) {
      target.removeAttribute('data-parallax');
      return;
    }
    frame = window.requestAnimationFrame(tick);
  };

  const kick = () => {
    if (frame) return;
    target.setAttribute('data-parallax', '');
    frame = window.requestAnimationFrame(tick);
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || !allowed()) {
      if (goal.x !== 0 || goal.y !== 0 || pos.x !== 0 || pos.y !== 0) {
        goal.x = 0;
        goal.y = 0;
        kick();
      }
      return;
    }
    goal.x = clamp((event.clientX / window.innerWidth) * 2 - 1);
    goal.y = clamp((event.clientY / window.innerHeight) * 2 - 1);
    kick();
  };

  // Verlässt der Zeiger das Fenster, kehren die Ebenen sanft in die Mitte zurück.
  const onLeave = () => {
    goal.x = 0;
    goal.y = 0;
    if (pos.x !== 0 || pos.y !== 0) kick();
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);
  return () => {
    window.removeEventListener('pointermove', onMove);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    pos.x = 0;
    pos.y = 0;
    target.removeAttribute('data-parallax');
    write();
  };
}
