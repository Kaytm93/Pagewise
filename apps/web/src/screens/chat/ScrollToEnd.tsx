import { ArrowDown } from 'lucide-react';
import type { MouseEvent } from 'react';
import { messages as m } from '../../i18n';
import { subjectColorAttr } from '../../ui/subject-color';

interface Props {
  /** Das Mitlesen ist gelöst und das Ende liegt weit weg (`useFollowEnd`: `away`). */
  visible: boolean;
  /** Eine Antwort läuft: ein kleiner Punkt zeigt, dass unten weiter Text kommt. */
  writing: boolean;
  /** Fachfarbe 0 bis 7 (oder `null`): der Punkt nimmt sie, sonst die Akzentfarbe. */
  subjectColor?: number | null;
  /** Scrollt ans Ende; `byKeyboard`, wenn Tastatur oder Hilfstechnik ausgelöst haben (Klick ohne Zeigerposition). */
  onToEnd: (byKeyboard: boolean) => void;
}

/**
 * „Zum Ende“-Knopf (F-082, D-118): ein runder Pfeilknopf unten rechts über der Eingabe. Er sitzt im klebenden
 * Eingabebereich und wandert mit dessen Höhe und der Tastatur (`--kb`) mit; die Lage steht in `screens.css`.
 *
 * Verborgen ist er nicht nur unsichtbar: Die Hülle ist `inert` (kein Fokus, nicht im Baum der Bedienhilfen) und
 * wird erst nach dem Ausblenden `visibility: hidden`. Das Ein- und Ausblenden ändert nur `opacity` und
 * `transform` (`screens.css`, 0 ms bei „Reduziert“ und „Aus“), darum muss das Element im Dokument bleiben.
 * Der Name für Bildschirmleser steht in `i18n/de.ts`; der Pfeil allein ist kein Text.
 */
export function ScrollToEnd({ visible, writing, subjectColor, onToEnd }: Props) {
  return (
    <div
      className="lg-toend"
      data-visible={visible}
      data-subj={subjectColorAttr(subjectColor)}
      aria-hidden={visible ? undefined : true}
      inert={!visible}
    >
      <button
        type="button"
        onClick={(event: MouseEvent<HTMLButtonElement>) => onToEnd(event.detail === 0)}
        aria-label={m.chat.toEnd}
        title={m.chat.toEnd}
        data-writing={writing || undefined}
        className="lg-toend-button mo-press inline-flex size-11 items-center justify-center rounded-full"
      >
        <ArrowDown aria-hidden="true" className="size-5" />
      </button>
    </div>
  );
}
