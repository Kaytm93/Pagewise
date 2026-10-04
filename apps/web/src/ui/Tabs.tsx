import { type KeyboardEvent, useId, useRef } from 'react';

interface Tab<T extends string> {
  value: T;
  label: string;
}

/**
 * Reiter mit Tastaturbedienung nach dem WAI-ARIA-Muster: Pfeiltasten wechseln (und wählen), Pos1 und Ende
 * springen, nur der gewählte Reiter ist per Tab erreichbar. `panel` ist der Inhalt des gewählten Reiters.
 */
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  panel,
}: {
  label: string;
  tabs: Tab<T>[];
  value: T;
  onChange: (value: T) => void;
  panel: React.ReactNode;
}) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idOf = (tab: T) => `${base}-${tab}`;

  function onKeyDown(event: KeyboardEvent, index: number) {
    const last = tabs.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + last) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    const tab = tabs[target];
    if (tab) {
      onChange(tab.value);
      refs.current[target]?.focus();
    }
  }

  return (
    <div>
      <div role="tablist" aria-label={label} className="flex gap-1 border-b border-line-warm">
        {tabs.map((tab, index) => {
          const selected = tab.value === value;
          return (
            <button
              key={tab.value}
              ref={(element) => {
                refs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${idOf(tab.value)}-tab`}
              aria-selected={selected}
              aria-controls={`${idOf(tab.value)}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`mo-press -mb-px inline-flex min-h-11 items-center border-b-2 px-3 font-heading text-lg tracking-[-0.1px] ${
                selected
                  ? 'border-subj text-ink'
                  : 'border-transparent text-ink-secondary hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${idOf(value)}-panel`}
        aria-labelledby={`${idOf(value)}-tab`}
        tabIndex={-1}
        className="outline-none"
      >
        {panel}
      </div>
    </div>
  );
}
