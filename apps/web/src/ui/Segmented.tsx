import { useId } from 'react';

interface Option<T extends string> {
  value: T;
  label: string;
}

/** Umschalter mit wenigen, gleichrangigen Optionen (Radiogruppe). Die gewählte Option ist in Graphite gefüllt. */
export function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="inline-flex max-w-full flex-wrap rounded-control border border-control-edge p-0.5">
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <div key={option.value} className="relative">
          <input
            type="radio"
            name={name}
            id={`${name}-${option.value}`}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="peer sr-only"
          />
          <label
            htmlFor={`${name}-${option.value}`}
            className="flex min-h-10 cursor-pointer items-center rounded-[4px] px-4 text-sm font-medium text-ink-secondary peer-checked:bg-primary peer-checked:text-on-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
          >
            {option.label}
          </label>
        </div>
      ))}
    </fieldset>
  );
}
