import { Check } from 'lucide-react';
import { useId } from 'react';
import { messages as m } from '../i18n';
import { SUBJECT_COLORS } from './subject-color';

/**
 * Auswahl der Fachfarbe aus den acht gedämpften Tönen der Oberfläche. Ohne Auswahl (`null`) wählt der Server
 * beim Anlegen die am seltensten genutzte. Der Name steht für Screenreader dabei: Die Farbe allein sagt nichts.
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
      <div className="mt-1.5 flex flex-wrap gap-2">
        {Array.from({ length: SUBJECT_COLORS }, (_, color) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: feste Reihe aus acht Farben, die Nummer ist die Farbe
          <div key={color} className="relative" data-subj={color}>
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
