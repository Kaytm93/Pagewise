import 'katex/dist/katex.min.css';
import { RenderError } from '@pagewise/render';
import { renderMathInto } from '@pagewise/render/math-dom';
import { useLayoutEffect, useRef, useState } from 'react';
import { messages as m } from '../../../i18n';
import { BlockError } from './BlockView';

/**
 * Eine Formel (KaTeX): im Text oder als eigener Absatz. KaTeX und seine Schrift werden mit diesem Baustein
 * geladen, also erst, wenn die erste Formel vorkommt. Bei einem Fehler steht der Quelltext da (und nach
 * Abschluss der Antwort eine Meldung).
 */
export default function MathView({
  latex,
  display,
  final,
}: {
  latex: string;
  display: boolean;
  final: boolean;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    try {
      renderMathInto(element, latex, display);
      setError(null);
    } catch (failure) {
      setError(failure instanceof RenderError ? failure.code : 'render_failed');
    }
  }, [latex, display]);

  if (error) {
    return display ? (
      <BlockError label={m.blocks.math} code={error} source={latex} final={final} />
    ) : (
      <code className="rounded-control bg-paper px-1.5 py-0.5 font-mono text-[0.9em]">
        {`$${latex}$`}
      </code>
    );
  }
  return display ? (
    <span ref={host} className="pg-math pg-math-display my-4 block overflow-x-auto" />
  ) : (
    <span ref={host} className="pg-math" />
  );
}
