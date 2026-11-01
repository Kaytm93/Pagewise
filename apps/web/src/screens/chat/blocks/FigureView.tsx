import { type FigureArtifact, parseFigureArtifact } from '@pagewise/render/figure';
import { lazy, Suspense, useMemo, useState } from 'react';
import { messages as m } from '../../../i18n';
import { Button } from '../../../ui/Button';
import { BlockError } from './BlockView';
import { fileName, saveBlob } from './download';

const BlockView = lazy(() => import('./BlockView'));

/**
 * Einzelne Abbildung als Datei (D-078): Vorschau wie im Chat und die Knöpfe „Als PNG herunterladen“ und „Als SVG
 * herunterladen“. Beide Dateien haben Druckfarben auf weißem Grund (PNG) bzw. ohne Hintergrund (SVG).
 */
export default function FigureView({ source, final }: { source: string; final: boolean }) {
  const parsed = useMemo(() => parseFigureArtifact(source), [source]);
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
  return <Figure key={source} spec={parsed.value} />;
}

function Figure({ spec }: { spec: FigureArtifact }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const t = m.blocks.figureView;

  const download = async (kind: 'png' | 'svg') => {
    setBusy(true);
    setFailed(false);
    try {
      const { rasterizeBlock, svgOfBlock } = await import('./raster');
      if (kind === 'png') {
        const raster = await rasterizeBlock(spec.figure.kind, spec.figure.source, 4);
        // Kein `fetch` auf die Daten-Adresse: `connect-src 'self'` der CSP verbietet das.
        const { bytesOfDataUrl } = await import('./ooxml');
        const bytes = bytesOfDataUrl(raster.dataUrl);
        saveBlob(new Blob([bytes as BlobPart], { type: 'image/png' }), fileName(spec.title, 'png'));
      } else {
        const svg = await svgOfBlock(spec.figure.kind, spec.figure.source);
        saveBlob(new Blob([svg], { type: 'image/svg+xml' }), fileName(spec.title, 'svg'));
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <figure className="my-4">
      <Suspense fallback={<div className="h-24" />}>
        <BlockView kind={spec.figure.kind} source={spec.figure.source} final size="min-h-24" />
      </Suspense>
      {spec.figure.caption && (
        <p className="text-center text-sm text-ink-secondary">{spec.figure.caption}</p>
      )}
      <figcaption className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" busy={busy} onClick={() => void download('png')}>
          {busy ? t.making : t.downloadPng}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void download('svg')}>
          {t.downloadSvg}
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
