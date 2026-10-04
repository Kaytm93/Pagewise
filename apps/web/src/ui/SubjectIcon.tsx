import {
  Atom,
  BookOpen,
  Calculator,
  Code,
  Dumbbell,
  FlaskConical,
  Globe,
  Landmark,
  Languages,
  Leaf,
  type LucideIcon,
  Microscope,
  Music,
  Palette,
  PenLine,
  Scale,
} from 'lucide-react';

/**
 * Auswahl einfacher Linien-Icons für Fächer. Der Server speichert nur die Kennung (z. B. „flask“),
 * unbekannte Kennungen zeigen das Standard-Icon.
 */
export const SUBJECT_ICONS: { id: string; label: string; Icon: LucideIcon }[] = [
  { id: 'book', label: 'Buch', Icon: BookOpen },
  { id: 'pen', label: 'Stift', Icon: PenLine },
  { id: 'languages', label: 'Sprachen', Icon: Languages },
  { id: 'calculator', label: 'Rechner', Icon: Calculator },
  { id: 'atom', label: 'Atom', Icon: Atom },
  { id: 'flask', label: 'Kolben', Icon: FlaskConical },
  { id: 'microscope', label: 'Mikroskop', Icon: Microscope },
  { id: 'leaf', label: 'Blatt', Icon: Leaf },
  { id: 'globe', label: 'Globus', Icon: Globe },
  { id: 'landmark', label: 'Gebäude', Icon: Landmark },
  { id: 'scale', label: 'Waage', Icon: Scale },
  { id: 'music', label: 'Musik', Icon: Music },
  { id: 'palette', label: 'Palette', Icon: Palette },
  { id: 'sport', label: 'Hantel', Icon: Dumbbell },
  { id: 'code', label: 'Code', Icon: Code },
];

const byId = new Map(SUBJECT_ICONS.map((entry) => [entry.id, entry.Icon]));
const FALLBACK: LucideIcon = BookOpen;

export function SubjectIcon({
  icon,
  className = 'size-[18px]',
  strokeWidth = 1.6,
}: {
  icon: string | null;
  className?: string;
  /** Strichstärke im 24er-Raster. Das große Motiv auf der Fachseite ist hauchdünn. */
  strokeWidth?: number;
}) {
  const Icon = (icon && byId.get(icon)) || FALLBACK;
  return <Icon aria-hidden="true" strokeWidth={strokeWidth} className={className} />;
}
