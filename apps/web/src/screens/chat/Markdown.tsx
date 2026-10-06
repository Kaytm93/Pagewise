import { normalizeDisplayMath } from '@pagewise/render';
import { BookMarked, Check, Copy, Lightbulb, PencilLine, Pin } from 'lucide-react';
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  lazy,
  memo,
  type ReactElement,
  type ReactNode,
  Suspense,
  useContext,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { format, messages as m } from '../../i18n';
import { useCopy } from './useCopy';

// Formeln und Blöcke bringen KaTeX, abcjs und die übrigen Zeichenbibliotheken mit und werden erst geladen, wenn
// ein solcher Block in einer Antwort vorkommt (das Hauptpaket bleibt klein, der Chat auch).
const MathView = lazy(() => import('./blocks/MathView'));
const BlockView = lazy(() => import('./blocks/BlockView'));

/** Ob die Antwort fertig ist: Während des Schreibens ist ein fehlerhafter Block meist nur unfertig. */
const FinalContext = createContext(true);

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const { copied, copy } = useCopy();
  const code = textOf(children).replace(/\n$/, '');
  return (
    <div className="group relative my-4">
      <pre className="overflow-x-auto rounded-box bg-paper p-4 pr-12 font-mono text-sm leading-relaxed text-ink [&_code]:bg-transparent [&_code]:p-0">
        {children}
      </pre>
      <button
        type="button"
        onClick={() => void copy(code)}
        aria-label={m.chat.copyCode}
        className="absolute top-1 right-1 inline-flex size-11 items-center justify-center rounded-control text-ink-muted hover:bg-sheet hover:text-ink"
      >
        {copied ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <Copy aria-hidden="true" className="size-4" />
        )}
      </button>
    </div>
  );
}

function BlockFallback() {
  return (
    <span
      role="status"
      className="pg-figure mo-shimmer my-4 block h-24 rounded-box bg-paper"
      aria-busy="true"
    >
      <span className="sr-only">{m.blocks.loading}</span>
    </span>
  );
}

/** Umzäunter Block: Formel als Anzeige, Graph, Molekül, Noten oder gewöhnlicher Code. */
function PreBlock({ children }: { children?: ReactNode }) {
  const final = useContext(FinalContext);
  const child = Array.isArray(children) ? children[0] : children;
  if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    const className = child.props.className ?? '';
    const source = textOf(child.props.children).replace(/\n$/, '');
    if (className.includes('math-display')) {
      return (
        <Suspense fallback={<BlockFallback />}>
          <MathView latex={source} display final={final} />
        </Suspense>
      );
    }
    const kind = /\blanguage-(graph|mol|abc)\b/.exec(className)?.[1];
    if (kind === 'graph' || kind === 'mol' || kind === 'abc') {
      return (
        <Suspense fallback={<BlockFallback />}>
          <BlockView kind={kind} source={source} final={final} />
        </Suspense>
      );
    }
  }
  return <CodeBlock>{children}</CodeBlock>;
}

const CALLOUT_ICONS = {
  merksatz: Pin,
  beispiel: Lightbulb,
  aufgabe: PencilLine,
  definition: BookMarked,
} as const;
type CalloutKind = keyof typeof CALLOUT_ICONS;
const CALLOUT = /^\[!(merksatz|beispiel|aufgabe|definition)\]\s*/i;

/**
 * Zitatblock. Beginnt er mit `[!merksatz]`, `[!beispiel]`, `[!aufgabe]` oder `[!definition]`, wird daraus ein
 * Hinweiskasten mit Beschriftung und Symbol (die Art steht immer auch als Text da, nie nur als Farbe).
 */
function Quote({ children }: { children?: ReactNode }) {
  const nodes = Children.toArray(children);
  const index = nodes.findIndex((node) => isValidElement(node));
  const first = index === -1 ? null : (nodes[index] as ReactElement<{ children?: ReactNode }>);
  const parts = first ? Children.toArray(first.props.children) : [];
  const head = parts[0];
  const match = typeof head === 'string' ? CALLOUT.exec(head) : null;
  if (!first || !match || typeof head !== 'string') {
    return (
      <blockquote className="my-4 border-l-2 border-line-warm pl-4 text-ink-secondary">
        {children}
      </blockquote>
    );
  }
  const kind = (match[1] as string).toLowerCase() as CalloutKind;
  const Icon = CALLOUT_ICONS[kind];
  const rest = [head.slice(match[0].length), ...parts.slice(1)];
  const content = [...nodes];
  content[index] = cloneElement(first, undefined, ...rest);
  return (
    <aside
      className="pg-callout my-4 rounded-box border-l-4 border-subj bg-paper px-4 py-3"
      data-callout={kind}
    >
      <p className="mb-1 flex items-center gap-2 font-heading text-sm font-medium text-ink">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {m.blocks.callout[kind]}
      </p>
      <div className="[&>p]:my-[0.4em] [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">{content}</div>
    </aside>
  );
}

/**
 * Formel im Text (`$…$`). Steht `$$…$$` in einer eigenen Zeile, behandelt remark-math sie ebenfalls als Formel
 * „im Text“, mit zusätzlicher Klasse `math-display`: Dann wird sie als eigener Absatz gezeichnet.
 */
function InlineMath({ latex, display }: { latex: string; display: boolean }) {
  const final = useContext(FinalContext);
  return (
    <Suspense fallback={<code className="font-mono text-[0.9em]">{`$${latex}$`}</code>}>
      <MathView latex={latex} display={display} final={final} />
    </Suspense>
  );
}

/**
 * Darstellung der Markdown-Elemente. Roher HTML-Code in der Antwort wird nicht ausgeführt, sondern als
 * Text gezeigt (react-markdown ohne rehype-raw), Links gehen nur über http, https oder mailto (Voreinstellung
 * von react-markdown) und öffnen in einem neuen Tab ohne Verweis. Bilder werden nie geladen: Ein Bild
 * in einer Modellantwort könnte Daten an eine fremde Adresse schicken, die CSP sperrt das ohnehin.
 */
const components: Components = {
  // Überschriften staffeln ab H2: unter der H1 der Ansicht (Chat-Titel) springt keine Ebene.
  p: ({ children }) => <p className="my-[0.9em] first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h2 className="mt-6 mb-2 font-heading text-xl first:mt-0">{children}</h2>,
  h2: ({ children }) => <h3 className="mt-6 mb-2 font-heading text-lg first:mt-0">{children}</h3>,
  h3: ({ children }) => (
    <h4 className="mt-5 mb-1.5 font-heading text-base font-medium first:mt-0">{children}</h4>
  ),
  h4: ({ children }) => (
    <h5 className="mt-4 mb-1 font-heading text-base font-medium first:mt-0">{children}</h5>
  ),
  h5: ({ children }) => <h6 className="mt-4 mb-1 font-medium first:mt-0">{children}</h6>,
  h6: ({ children }) => <h6 className="mt-4 mb-1 font-medium first:mt-0">{children}</h6>,
  ul: ({ children, className }) => {
    // Aufgabenlisten (remark-gfm, `- [ ]`) bringen ihr eigenes Kästchen mit: keine Aufzählungspunkte zusätzlich.
    const tasks = className?.includes('contains-task-list') ?? false;
    return (
      <ul
        className={`my-[0.9em] space-y-[0.55em] pl-[1.4em] ${tasks ? '' : 'list-disc marker:text-ink-muted'} ${className ?? ''}`}
      >
        {children}
      </ul>
    );
  },
  ol: ({ children, className }) => {
    const tasks = className?.includes('contains-task-list') ?? false;
    return (
      <ol
        className={`my-[0.9em] space-y-[0.55em] pl-[1.4em] ${tasks ? '' : 'list-decimal marker:text-ink-muted'} ${className ?? ''}`}
      >
        {children}
      </ol>
    );
  },
  li: ({ children, className }) => (
    <li
      className={
        className?.includes('task-list-item') ? className : `pl-[0.3em] ${className ?? ''}`.trim()
      }
    >
      {children}
    </li>
  ),
  // Ein Link, den react-markdown als unsicher entfernt hat (z. B. javascript:), bleibt einfacher Text.
  a: ({ href, children }) =>
    href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="break-words text-link underline underline-offset-2"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  blockquote: ({ children }) => <Quote>{children}</Quote>,
  hr: () => <hr className="my-6 border-line" />,
  pre: ({ children }) => <PreBlock>{children}</PreBlock>,
  code: ({ children, className }) =>
    className?.includes('math-inline') ? (
      <InlineMath latex={textOf(children)} display={className.includes('math-display')} />
    ) : (
      <code
        className={`rounded-control bg-paper px-1.5 py-0.5 font-mono text-[0.9em] ${className ?? ''}`}
      >
        {children}
      </code>
    ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-line-warm px-3 py-2 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-line px-3 py-2 align-top">{children}</td>,
  img: ({ alt }) => (
    <span className="text-ink-muted">
      {alt ? format(m.chat.imageOmitted, { alt }) : m.chat.imageOmittedNoAlt}
    </span>
  ),
};

/** Antwort des Modells als Markdown, sicher dargestellt. */
export const Markdown = memo(function Markdown({
  text,
  final = true,
}: {
  text: string;
  /** Falsch, solange die Antwort noch geschrieben wird: Blöcke zeigen dann keine Fehlermeldung. */
  final?: boolean;
}) {
  return (
    <FinalContext.Provider value={final}>
      <div className="max-w-[66ch] text-[1.0625rem] leading-[1.72] break-words">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} components={components}>
          {normalizeDisplayMath(text)}
        </ReactMarkdown>
      </div>
    </FinalContext.Provider>
  );
});
