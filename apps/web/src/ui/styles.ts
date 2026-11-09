/** Überschrift eines Abschnitts auf dem Blatt: klein, groß geschrieben, gedämpft (Gestaltung „Lagen“, D-043). */
export const sectionTitle =
  'font-sans text-[15px] font-medium tracking-[0.06em] text-ink-muted uppercase';

/** Zeile einer Liste mit Fachfarbe am Rand: für Fächer, Chats und Untergruppen. */
export const listRow =
  'lg-row flex min-h-16 min-w-0 flex-1 flex-col justify-center rounded-[2px] px-2 py-3 text-ink no-underline';

/**
 * Zeile mit Knopf am Ende (Chats, Einträge, Gruppen; D-108): Der Knopf sitzt in der Zeile, nicht als Spalte
 * daneben. So reichen Zeile, Trennlinie und Hover über die ganze Breite, und nichts ragt über den Rand der Liste.
 * `listRowHost` gehört an das `li`, `listRowLead` an die Zeile (hält rechts Platz frei), `listRowAction` an den Knopf.
 */
export const listRowHost = 'relative flex items-center';
export const listRowLead = `${listRow} lg-row-lead pr-14`;
export const listRowAction =
  'lg-row-action mo-press absolute inset-y-0 right-1 my-auto inline-flex size-11 items-center justify-center rounded-[10px] text-ink-muted hover:bg-paper hover:text-ink disabled:opacity-50';

/**
 * Symbol-Knopf ohne eigene Fläche, 44 px (Kopfleisten, Listen, Einstellungen; D-109): Hover hinterlegt die Fläche,
 * gedrückt gibt er nach (`mo-tap`), deaktiviert ist er blass. In „Raum“ bleibt er flach; gehoben ist nur `mo-press`.
 */
export const iconButton =
  'mo-tap inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-paper hover:text-ink disabled:opacity-50';

/**
 * Leerer Zustand einer Liste („Noch keine …“ mit einem Satz dazu; D-111): eine ruhige Fläche mit 16 px Polster.
 * In „Raum“ ist sie eine leere Mulde wie die Liste, die später an ihrer Stelle steht (raum.css, `.lg-empty`).
 */
export const emptyState = 'lg-empty rounded-box bg-paper p-4';

/** Ladegerüst einer Liste: dieselben Linien wie die echte Liste (in „Raum“ dieselbe Mulde, siehe raum.css). */
export const listSkeleton = 'lg-skel-rows mt-3 border-t border-line-warm';
export const listSkeletonRow = 'lg-skel-row grid gap-2.5 border-b border-line-warm px-2 py-[18px]';
