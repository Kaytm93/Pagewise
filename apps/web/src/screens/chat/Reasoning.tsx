import { messages as m } from '../../i18n';

/**
 * Denkprozess des Modells: klein und eingeklappt, solange die Antwort fertig ist; während sie entsteht, ist er
 * offen. Nur Text, nie HTML: die Ausgabe des Modells ist nicht vertrauenswürdig.
 */
export function Reasoning({ text, live }: { text: string; live: boolean }) {
  return (
    <details open={live} className="mb-2 text-meta text-ink-muted">
      <summary className="inline-flex min-h-11 cursor-pointer items-center">
        {m.chat.reasoning}
      </summary>
      <p className="break-words whitespace-pre-wrap leading-relaxed">{text}</p>
    </details>
  );
}
