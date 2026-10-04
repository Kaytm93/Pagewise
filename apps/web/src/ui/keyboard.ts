/**
 * Tastatur auf iPhone und iPad. Safari verkleinert beim Einblenden der Bildschirmtastatur nur den sichtbaren
 * Ausschnitt (`visualViewport`), nicht die Seite: Eine am unteren Rand klebende Eingabezeile läge unter der Tastatur.
 * Dieses Modul misst den Abstand zwischen dem unteren Rand des Ausschnitts und dem der Seite und legt ihn als
 * Variable `--kb` (in Pixeln) auf `<html>`. Die Eingabezeile (`bottom-[var(--kb,0px)]`) und die Dialoge heben sich
 * damit über die Tastatur.
 *
 * Bewusst nicht benutzt: `interactive-widget` (Safari kennt es nicht) und die VirtualKeyboard-API (ebenso). Die
 * Variable wird über das CSSOM gesetzt (`style.setProperty`), nie als Inline-Style im Markup (CSP, D-023).
 */

export const KEYBOARD_VAR = '--kb';

/** Unter dieser Höhe ist es keine Tastatur, sondern Browser-Leiste oder Rundung. */
const MIN_KEYBOARD_PX = 40;

interface ViewportLike {
  height: number;
  offsetTop: number;
  scale: number;
  addEventListener(type: 'resize' | 'scroll', listener: () => void): void;
  removeEventListener(type: 'resize' | 'scroll', listener: () => void): void;
}

export interface KeyboardEnvironment {
  visualViewport?: ViewportLike | null;
  innerHeight: number;
  root: Pick<HTMLElement, 'style'>;
}

/** Höhe der Tastatur in Pixeln (0, wenn keine sichtbar ist oder die Seite herangezoomt wurde). */
export function keyboardInset(
  innerHeight: number,
  viewport: Pick<ViewportLike, 'height' | 'offsetTop' | 'scale'>,
): number {
  // Beim Heranzoomen schrumpft der Ausschnitt ebenfalls, das ist keine Tastatur.
  if (Math.abs(viewport.scale - 1) > 0.01) return 0;
  const inset = innerHeight - viewport.height - viewport.offsetTop;
  return inset >= MIN_KEYBOARD_PX ? Math.round(inset) : 0;
}

/**
 * Beginnt, `--kb` nachzuführen. Gibt eine Funktion zurück, die aufhört und die Variable entfernt. Ohne
 * `visualViewport` (ältere Browser, Tests) passiert nichts.
 */
export function startKeyboardInset(
  env: KeyboardEnvironment = {
    visualViewport: globalThis.visualViewport as ViewportLike | undefined,
    get innerHeight() {
      return globalThis.innerHeight;
    },
    root: globalThis.document?.documentElement,
  },
): () => void {
  const viewport = env.visualViewport;
  if (!viewport || !env.root) return () => {};
  let last = -1;
  const update = (): void => {
    const inset = keyboardInset(env.innerHeight, viewport);
    if (inset === last) return;
    last = inset;
    if (inset === 0) env.root.style.removeProperty(KEYBOARD_VAR);
    else env.root.style.setProperty(KEYBOARD_VAR, `${inset}px`);
  };
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  update();
  return () => {
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
    env.root.style.removeProperty(KEYBOARD_VAR);
  };
}
