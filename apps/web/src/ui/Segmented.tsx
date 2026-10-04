import { useId, useLayoutEffect, useRef } from 'react';

interface Option<T extends string> {
  value: T;
  label: string;
}

/**
 * Umschalter mit wenigen, gleichrangigen Optionen (Radiogruppe). Die gewählte Option liegt als aufgelegter
 * Streifen unter dem Text und gleitet mit der Feder zur neuen Wahl (`--idx`, `--n` setzt das Skript über das
 * CSSOM, siehe D-023). Ohne Bewegung (Effektstufe „Aus“) springt er.
 */
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
  const root = useRef<HTMLFieldSetElement>(null);
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  useLayoutEffect(() => {
    root.current?.style.setProperty('--n', String(options.length));
    root.current?.style.setProperty('--idx', String(index));
  }, [options.length, index]);

  return (
    <fieldset ref={root} className="lg-seg m-0 min-w-0">
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className="mo-press relative flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[9px] px-3 text-center text-[14.5px] text-ink-secondary has-[:checked]:font-medium has-[:checked]:text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="absolute inset-0 m-0 size-full cursor-pointer opacity-0"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
