import { Check, Copy } from 'lucide-react';
import { isValidElement, memo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { format, messages as m } from '../../i18n';
import { useCopy } from './useCopy';

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

/**
 * Darstellung der Markdown-Elemente. Roher HTML-Code in der Antwort wird nicht ausgeführt, sondern als
 * Text gezeigt (react-markdown ohne rehype-raw), Links gehen nur über http, https oder mailto (Voreinstellung
 * von react-markdown) und öffnen in einem neuen Tab ohne Verweis. Bilder werden nie geladen: Ein Bild
 * in einer Modellantwort könnte Daten an eine fremde Adresse schicken, die CSP sperrt das ohnehin.
 */
const components: Components = {
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
  ul: ({ children }) => (
    <ul className="my-[0.9em] list-disc space-y-[0.55em] pl-[1.4em] marker:text-ink-muted">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-[0.9em] list-decimal space-y-[0.55em] pl-[1.4em] marker:text-ink-muted">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-[0.3em]">{children}</li>,
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
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-line-warm pl-4 text-ink-secondary">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-line" />,
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ children, className }) => (
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
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="max-w-[66ch] text-[1.0625rem] leading-[1.72] break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
