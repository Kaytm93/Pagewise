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
import { messages as m } from '../i18n';

/**
 * Auswahl einfacher Linien-Icons für Fächer. Der Server speichert nur die Kennung (z. B. „flask“),
 * unbekannte Kennungen zeigen das Standard-Icon. Die Namen für Bildschirmleser stehen in `i18n/de.ts`
 * (`subjectDialog.iconNames`).
 */
export const SUBJECT_ICONS: { id: string; label: string; Icon: LucideIcon }[] = [
  { id: 'book', label: m.subjectDialog.iconNames.book, Icon: BookOpen },
  { id: 'pen', label: m.subjectDialog.iconNames.pen, Icon: PenLine },
  { id: 'languages', label: m.subjectDialog.iconNames.languages, Icon: Languages },
  { id: 'calculator', label: m.subjectDialog.iconNames.calculator, Icon: Calculator },
  { id: 'atom', label: m.subjectDialog.iconNames.atom, Icon: Atom },
  { id: 'flask', label: m.subjectDialog.iconNames.flask, Icon: FlaskConical },
  { id: 'microscope', label: m.subjectDialog.iconNames.microscope, Icon: Microscope },
  { id: 'leaf', label: m.subjectDialog.iconNames.leaf, Icon: Leaf },
  { id: 'globe', label: m.subjectDialog.iconNames.globe, Icon: Globe },
  { id: 'landmark', label: m.subjectDialog.iconNames.landmark, Icon: Landmark },
  { id: 'scale', label: m.subjectDialog.iconNames.scale, Icon: Scale },
  { id: 'music', label: m.subjectDialog.iconNames.music, Icon: Music },
  { id: 'palette', label: m.subjectDialog.iconNames.palette, Icon: Palette },
  { id: 'sport', label: m.subjectDialog.iconNames.sport, Icon: Dumbbell },
  { id: 'code', label: m.subjectDialog.iconNames.code, Icon: Code },
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
