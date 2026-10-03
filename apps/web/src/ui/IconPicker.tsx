import { useId } from 'react';
import { SUBJECT_ICONS, SubjectIcon } from './SubjectIcon';

/** Auswahl eines Fach-Symbols. Immer eines gewählt; „book“ ist auch das Standard-Symbol. */
export function IconPicker({
  legend,
  value,
  onChange,
}: {
  legend: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      <div className="mt-1.5 grid grid-cols-5 gap-1.5">
        {SUBJECT_ICONS.map(({ id, label }) => (
          <div key={id} className="relative">
            <input
              type="radio"
              name={name}
              id={`${name}-${id}`}
              value={id}
              checked={value === id}
              onChange={() => onChange(id)}
              className="peer sr-only"
            />
            <label
              htmlFor={`${name}-${id}`}
              className="flex size-11 cursor-pointer items-center justify-center rounded-control border border-line text-ink-secondary hover:bg-paper peer-checked:border-ink peer-checked:bg-paper peer-checked:text-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
            >
              <SubjectIcon icon={id} className="size-5" />
              <span className="sr-only">{label}</span>
            </label>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
