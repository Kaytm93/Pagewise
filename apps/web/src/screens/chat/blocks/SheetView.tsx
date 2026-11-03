import { parseSheetSpec, type SheetSpec } from '@pagewise/render/sheet';
import { useMemo, useState } from 'react';
import { format, messages as m } from '../../../i18n';
import { Button } from '../../../ui/Button';
import { BlockError } from './BlockView';
import { fileName, saveBlob } from './download';

/** Zeilen je Blatt in der Vorschau; die Datei enthält alle. */
const PREVIEW_ROWS = 12;

/**
 * Tabellendatei unter der Antwort (D-077): Vorschau aus Text und die Knöpfe „Als Excel herunterladen“ und „Als CSV
 * herunterladen“. Die Datei entsteht erst beim Klicken, im Gerät.
 */
export default function SheetView({ source, final }: { source: string; final: boolean }) {
  const parsed = useMemo(() => parseSheetSpec(source), [source]);
  if (!parsed.ok) {
    return (
      <BlockError label={m.blocks.sheet} code={parsed.error.code} source={source} final={final} />
    );
  }
  return <Sheets key={source} spec={parsed.value} />;
}

function Sheets({ spec }: { spec: SheetSpec }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const t = m.blocks.sheetView;

  const download = async (kind: 'xlsx' | 'csv') => {
    setBusy(true);
    setFailed(false);
    try {
      const files = await import('./xlsx');
      if (kind === 'xlsx') {
        saveBlob(files.buildXlsx(spec), fileName(spec.title, 'xlsx'));
      } else {
        // CSV kennt nur ein Blatt: das erste.
        const first = spec.sheets[0];
        if (!first) throw new Error('sheet: leer');
        saveBlob(files.buildCsv(first), fileName(spec.title, 'csv'));
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <figure className="pg-sheet my-4">
      <div className="space-y-4">
        {spec.sheets.map((sheet) => (
          <section key={sheet.name} aria-label={format(t.sheetOf, { name: sheet.name })}>
            {spec.sheets.length > 1 && (
              <p className="mb-1 font-heading text-sm font-medium">{sheet.name}</p>
            )}
            <div className="overflow-x-auto rounded-box border border-control-edge">
              <table className="w-full border-collapse text-sm">
                {sheet.header && (
                  <thead>
                    <tr>
                      {sheet.header.map((cell, i) => (
                        <th
                          // biome-ignore lint/suspicious/noArrayIndexKey: die Tabelle steht fest, sie wird nie umsortiert
                          key={`${i}:${cell}`}
                          className="border-b border-control-edge bg-paper px-2 py-1 text-left font-medium"
                        >
                          {cell}
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {sheet.rows.slice(0, PREVIEW_ROWS).map((row, r) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: die Tabelle steht fest, sie wird nie umsortiert
                    <tr key={`${r}:${row.join('|')}`}>
                      {row.map((cell, i) => (
                        <td
                          // biome-ignore lint/suspicious/noArrayIndexKey: die Tabelle steht fest, sie wird nie umsortiert
                          key={`${i}:${cell}`}
                          className={`border-b border-control-edge px-2 py-1 ${typeof cell === 'number' ? 'text-right tabular-nums' : ''}`}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sheet.rows.length > PREVIEW_ROWS && (
              <p className="mt-1 text-meta text-ink-muted">
                {format(t.moreRows, { count: sheet.rows.length - PREVIEW_ROWS })}
              </p>
            )}
          </section>
        ))}
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" busy={busy} onClick={() => void download('xlsx')}>
          {busy ? t.making : t.downloadXlsx}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void download('csv')}>
          {t.downloadCsv}
        </Button>
        {failed && (
          <span role="status" className="text-sm text-danger">
            {t.failed}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
