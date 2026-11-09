import { useLayoutEffect, useRef } from 'react';
import { SubjectGlyph } from '../../ui/SubjectIcon';

/** Strichstärke im 24er-Raster des Symbols; das große Motiv ist hauchdünn (Mockup A: `stroke-width: .24`). */
const MOTIF_STROKE = 0.24;

/** Die Formen eines Fachmotivs, die einen Strich tragen. */
const SHAPES = 'path, circle, rect, line, polyline, polygon, ellipse';

/**
 * Das Linienmotiv im Kopf der Fachseite in der Richtung „Lagen“: das Fachsymbol, sehr groß und hauchdünn in der
 * Fachfarbe. Beim Erscheinen zeichnet es sich Strich für Strich (lagen.css, `.lg-motif-stroke`, Keyframe `draw`).
 *
 * Dafür trägt jede Form `pathLength="1"` und die Klasse `lg-motif-stroke` (dieselbe Klasse zeichnet auch das
 * Motiv der Richtung „Atelier“, dort mit eigenem CSS) plus `mo-i-N` für die Staffelung. Die Motive aus
 * `ui/SubjectIcon.tsx` tragen diese Attribute nicht selbst (sie dienen auch als kleines Symbol); sie werden darum
 * nach dem Einhängen am DOM gesetzt (Attribute und Klassen, kein `style`). Das Motiv ist reine Zier
 * (`aria-hidden`). Ohne Kennung zeichnet sich das neutrale Motiv (D-110).
 */
export function SubjectMotif({
  icon,
  className = '',
}: {
  icon: string | null;
  className?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Mit der Kennung wechselt die Zeichnung; ihre neuen Formen müssen erneut markiert werden
  useLayoutEffect(() => {
    ref.current?.querySelectorAll(SHAPES).forEach((shape, index) => {
      shape.setAttribute('pathLength', '1');
      shape.classList.add('lg-motif-stroke', `mo-i-${Math.min(index + 1, 6)}`);
    });
  }, [icon]);

  return (
    <SubjectGlyph
      icon={icon}
      ref={ref}
      strokeWidth={MOTIF_STROKE}
      className={`lg-motif ${className}`.trim()}
    />
  );
}
