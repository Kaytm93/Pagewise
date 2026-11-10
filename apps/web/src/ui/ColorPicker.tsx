import { Check } from 'lucide-react';
import { useId } from 'react';
import { messages as m } from '../i18n';
import { SUBJECT_COLORS } from './subject-color';

/**
 * Auswahl der Fachfarbe aus den acht gedämpften Tönen der Oberfläche. Ohne Auswahl (`null`) wählt der Server
 * beim Anlegen die am seltensten genutzte. Der Name steht für Screenreader dabei: Die Farbe allein sagt nichts.
 *
 * Das Raster ist das der Symbolwahl (`IconPicker`: fünf Spalten, gleiche Abstände, derselbe Knopf von 44 px links in
 * der Zelle), damit die Punkte bündig auf den Symbolspalten stehen (D-117). Acht Farben in zwei Reihen zu vier: Die
 * Reihen beginnen in der ersten Spalte (`col-start-1`) und stehen so auf den ersten vier Symbolspalten.
 */
export function ColorPicker({
  legend,
  hint,
  value,
  onChange,
}: {
  legend: string;
  hint?: string;
  value: number | null;
  onChange: (color: number) => void;
}) {
  const name = useId();
  const names = m.subjectDialog.colorNames;
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      <div className="mt-1.5 grid grid-cols-5 gap-1.5">
        {Array.from({ length: SUBJECT_COLORS }, (_, color) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: feste Reihe aus acht Farben, die Nummer ist die Farbe
            key={color}
            className={color % 4 === 0 ? 'relative col-start-1' : 'relative'}
            data-subj={color}
          >
            <input
              type="radio"
              name={name}
              id={`${name}-${color}`}
              value={color}
              checked={value === color}
              onChange={() => onChange(color)}
              className="peer sr-only"
            />
            <label
              htmlFor={`${name}-${color}`}
              className="mo-press flex size-11 cursor-pointer items-center justify-center rounded-full border border-line-warm peer-checked:ring-2 peer-checked:ring-ink peer-checked:ring-offset-2 peer-checked:ring-offset-sheet peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
            >
              <span className="flex size-7 items-center justify-center rounded-full bg-subj text-on-subj">
                {value === color && <Check aria-hidden="true" className="size-4" />}
              </span>
              <span className="sr-only">{names[color]}</span>
            </label>
          </div>
        ))}
      </div>
      {hint && <p className="mt-1.5 text-sm text-ink-muted">{hint}</p>}
    </fieldset>
  );
}
