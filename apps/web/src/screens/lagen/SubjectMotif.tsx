import { BookOpen } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { SUBJECT_ICONS } from '../../ui/SubjectIcon';

/** Strichstärke im 24er-Raster des Symbols; das große Motiv ist hauchdünn (Mockup A: `stroke-width: .24`). */
const MOTIF_STROKE = 0.24;

/** Die Formen eines Lucide-Symbols, die einen Strich tragen. */
const SHAPES = 'path, circle, rect, line, polyline, polygon, ellipse';

/**
 * Das Linienmotiv im Kopf der Fachseite in der Richtung „Lagen“: das Fachsymbol, sehr groß und hauchdünn in der
 * Fachfarbe. Beim Erscheinen zeichnet es sich Strich für Strich (lagen.css, `.lg-motif-stroke`, Keyframe `draw`).
 *
 * Dafür trägt jede Form `pathLength="1"` und die Klasse `lg-motif-stroke` (dieselbe Klasse zeichnet auch das
 * Motiv der Richtung „Atelier“, dort mit eigenem CSS) plus `mo-i-N` für die Staffelung. Lucide gibt seinen Formen
 * keine Attribute mit; sie werden darum nach dem Einhängen am DOM gesetzt (Attribute und Klassen, kein
 * `style`). Das Motiv ist reine Zier (`aria-hidden`).
 */
export function SubjectMotif({
  icon,
  className = '',
}: {
  icon: string | null;
  className?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const Icon = SUBJECT_ICONS.find((entry) => entry.id === icon)?.Icon ?? BookOpen;

  // biome-ignore lint/correctness/useExhaustiveDependencies: Icon wechselt mit der Kennung; beim Wechsel entstehen neue Formen, die erneut markiert werden müssen
  useLayoutEffect(() => {
    ref.current?.querySelectorAll(SHAPES).forEach((shape, index) => {
      shape.setAttribute('pathLength', '1');
      shape.classList.add('lg-motif-stroke', `mo-i-${Math.min(index + 1, 6)}`);
    });
  }, [Icon]);

  return (
    <Icon
      ref={ref}
      aria-hidden="true"
      strokeWidth={MOTIF_STROKE}
      className={`lg-motif ${className}`.trim()}
    />
  );
}
