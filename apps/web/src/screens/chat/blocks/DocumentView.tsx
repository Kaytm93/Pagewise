import { type DocumentSpec, parseDocumentSpec } from '@pagewise/render/document';
import { lazy, Suspense, useMemo, useState } from 'react';
import { messages as m } from '../../../i18n';
import { Button } from '../../../ui/Button';
import { BlockError } from './BlockView';
import { fileName, saveBlob } from './download';
import { buildPdf } from './pdf';

const BlockView = lazy(() => import('./BlockView'));

/**
 * Dokument im Chat: eine Vorschau aus Text (ohne Netz) und der Knopf „Als PDF herunterladen“. Die PDF-Datei
 * entsteht erst beim Klicken, im Gerät. Die Vorschau zeigt, was die Datei enthält.
 */
export default function DocumentView({ source, final }: { source: string; final: boolean }) {
  const parsed = useMemo(() => parseDocumentSpec(source), [source]);
  if (!parsed.ok) {
    return (
      <BlockError
        label={m.blocks.document}
        code={parsed.error.code}
        source={source}
        final={final}
      />
    );
  }
  return <Document key={source} spec={parsed.value} />;
}

function Document({ spec }: { spec: DocumentSpec }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const download = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const blob = await buildPdf(spec);
      saveBlob(blob, fileName(spec.title, 'pdf'));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <figure className="pg-document my-4">
      <article
        aria-label={spec.title}
        className="mx-auto max-w-[21cm] rounded-box border border-control-edge bg-canvas p-6 text-ink"
      >
        <p className="font-heading text-lg font-medium">{spec.title}</p>
        {spec.parts.map((part, index) => {
          const key = String(index);
          if (part.type === 'heading') {
            return (
              <p key={key} className="mt-5 font-heading font-medium">
                {part.text}
              </p>
            );
          }
          if (part.type === 'paragraph') {
            return (
              <p key={key} className="mt-2 leading-relaxed">
                {part.text}
              </p>
            );
          }
          if (part.type === 'table') {
            return (
              <div key={key} className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  {part.header && (
                    <thead>
                      <tr>
                        {part.header.map((cell, i) => (
                          <th
                            // biome-ignore lint/suspicious/noArrayIndexKey: die Tabelle steht fest, sie wird nie umsortiert
                            key={`${i}:${cell}`}
                            className="border border-control-edge bg-paper px-2 py-1 text-left font-medium"
                          >
                            {cell}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {part.rows.map((row, r) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: die Tabelle steht fest, sie wird nie umsortiert
                      <tr key={`${r}:${row.join('|')}`}>
                        {row.map((cell, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: die Tabelle steht fest, sie wird nie umsortiert
                          <td key={`${i}:${cell}`} className="border border-control-edge px-2 py-1">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          if (part.type === 'figure') {
            return (
              <div key={key} className="mt-3">
                <Suspense fallback={<div className="h-24" />}>
                  <BlockView kind={part.kind} source={part.source} final size="min-h-24" />
                </Suspense>
                {part.caption && (
                  <p className="text-center text-sm text-ink-secondary">{part.caption}</p>
                )}
              </div>
            );
          }
          return (
            <ul key={key} className="mt-2 list-disc space-y-1 pl-6 marker:text-ink-muted">
              {part.items.map((item, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: die Aufzählung steht fest, sie wird nie umsortiert
                <li key={`${i}:${item}`} className="leading-relaxed">
                  {item}
                </li>
              ))}
            </ul>
          );
        })}
      </article>
      <figcaption className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" busy={busy} onClick={() => void download()}>
          {busy ? m.blocks.documentView.making : m.blocks.documentView.download}
        </Button>
        {failed && (
          <span role="status" className="text-sm text-danger">
            {m.blocks.documentView.failed}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
