import { RenderError } from '@pagewise/render';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { format, messages as m } from '../../../i18n';
import { renderBlock, type SvgBlockKind } from './render';

type State =
  | { status: 'loading' }
  | { status: 'ready'; svg: string }
  | { status: 'error'; code: string };

/** Fehlertext zu einem festen Code; unbekannte Codes zeigen den allgemeinen Text. */
export function errorText(code: string): string {
  const errors = m.blocks.errors as Record<string, string>;
  return errors[code] ?? m.blocks.errors.render_failed;
}

/**
 * Fehlerzustand eines Blocks: eine verständliche Meldung und der Quelltext zum Nachlesen und Kopieren. Solange
 * die Antwort noch geschrieben wird (`final` ist falsch), ist ein Fehler meist nur ein unfertiger Block: dann
 * steht der Text ruhig als Code da, ohne Meldung.
 */
export function BlockError({
  label,
  code,
  source,
  final,
}: {
  label: string;
  code: string;
  source: string;
  final: boolean;
}) {
  return (
    <figure className="pg-figure my-4" data-block-error={final ? code : undefined}>
      {final && (
        <p role="note" className="mb-2 text-sm text-danger">
          {format(m.blocks.errorTitle, { kind: label })} {errorText(code)}
        </p>
      )}
      <pre className="overflow-x-auto rounded-box bg-paper p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap text-ink">
        {source}
      </pre>
    </figure>
  );
}

/** Voreinstellung der Blattbreite, bevor gemessen ist: volle Graphenbreite (36rem), also keine Kompensation. */
const SHEET_DEFAULT_WIDTH = 576;

/**
 * Das gezeichnete SVG; gesetzt wird der bereinigte Text über das Element, nie aus Rohtext. Der Graph bekommt
 * die gemessene Breite seines Blatts: Die Achsenbeschriftung wird dann so gezeichnet, dass sie auf schmalen
 * Blättern (Handy) ihre Mindestgröße behält, statt mit dem viewBox zu schrumpfen. Vor dem ersten Messwert
 * gilt die volle Breite (36rem, der Wert des breiten Blatts). Graph allein: Molekül und Noten skalieren
 * nicht auf die Blattbreite.
 */
function SvgHost({
  svg,
  label,
  kind,
  sheetWidth,
  onSheetWidth,
}: {
  svg: string;
  label: string;
  kind: SvgBlockKind;
  sheetWidth: number | null;
  onSheetWidth: (width: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const graph = kind === 'graph';

  useLayoutEffect(() => {
    if (host.current) host.current.innerHTML = svg;
  }, [svg]);

  useLayoutEffect(() => {
    const element = host.current;
    if (!graph || !element) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) onSheetWidth(Math.round(width));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [graph, onSheetWidth]);

  return (
    <div
      ref={host}
      role="img"
      aria-label={label}
      className="pg-svg"
      data-sheet-width={graph ? Math.round(sheetWidth ?? SHEET_DEFAULT_WIDTH) : undefined}
    />
  );
}

/** Graph, Molekül oder Noten: lädt die Zeichenbibliothek bei Bedarf und zeigt Ladezustand, Bild oder Fehler. */
export default function BlockView({
  kind,
  source,
  final,
  size,
}: {
  kind: SvgBlockKind;
  source: string;
  final: boolean;
  /** Größenklassen (Seitenverhältnis oder feste Höhe) aus Markdown.tsx: gleich für Platzhalter und Bild. */
  size: string;
}) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [sheetWidth, setSheetWidth] = useState<number | null>(null);
  const label = m.blocks[kind];

  useEffect(() => {
    let cancelled = false;
    setState((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    renderBlock(kind, source, sheetWidth).then(
      (svg) => {
        if (!cancelled) setState({ status: 'ready', svg });
      },
      (error) => {
        if (!cancelled) {
          setState({
            status: 'error',
            code: error instanceof RenderError ? error.code : 'render_failed',
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [kind, source, sheetWidth]);

  if (state.status === 'error') {
    return <BlockError label={label} code={state.code} source={source} final={final} />;
  }
  if (state.status === 'loading') {
    return (
      <figure
        className={`pg-figure mo-shimmer my-4 rounded-box bg-paper ${size}`}
        aria-busy="true"
        aria-label={m.blocks.loading}
      />
    );
  }
  return (
    <figure className={`pg-figure pg-${kind} my-4 ${size}`}>
      <SvgHost
        svg={state.svg}
        label={label}
        kind={kind}
        sheetWidth={sheetWidth}
        onSheetWidth={setSheetWidth}
      />
    </figure>
  );
}
