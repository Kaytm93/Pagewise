import { parseSlidesSpec, type SlidesSpec } from '@pagewise/render/slides';
import { useMemo, useState } from 'react';
import { format, messages as m } from '../../../i18n';
import { Button } from '../../../ui/Button';
import { BlockError } from './BlockView';
import { fileName, saveBlob } from './download';
import { buildPptx } from './pptx';

/**
 * Präsentation im Chat: jede Folie als Karte im Format 16:9 (Vorschau aus Text, ohne Netz), darunter der Knopf
 * „Als PowerPoint herunterladen“. Die Datei entsteht erst beim Klicken, im Gerät.
 */
export default function SlidesView({ source, final }: { source: string; final: boolean }) {
  const parsed = useMemo(() => parseSlidesSpec(source), [source]);
  if (!parsed.ok) {
    return (
      <BlockError label={m.blocks.slides} code={parsed.error.code} source={source} final={final} />
    );
  }
  return <Slides key={source} spec={parsed.value} />;
}

function Slides({ spec }: { spec: SlidesSpec }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const total = spec.slides.length;

  const download = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const blob = await buildPptx(spec);
      saveBlob(blob, fileName(spec.title, 'pptx'));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <figure className="pg-slides my-4">
      <ol className="m-0 grid list-none gap-4 p-0">
        {spec.slides.map((slide, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: die Folien stehen fest, sie werden nie umsortiert
          <li key={index}>
            <section
              aria-label={format(m.blocks.slidesView.slideOf, { n: index + 1, total })}
              className="flex aspect-video flex-col gap-3 rounded-box border border-control-edge bg-canvas p-5 text-ink"
            >
              <p className="font-heading text-lg font-medium">{slide.title}</p>
              {slide.bullets.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm marker:text-ink-muted">
                  {slide.bullets.map((bullet, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: die Aufzählung steht fest, sie wird nie umsortiert
                    <li key={`${i}:${bullet}`}>{bullet}</li>
                  ))}
                </ul>
              )}
              {slide.text !== undefined && <p className="text-sm leading-relaxed">{slide.text}</p>}
            </section>
          </li>
        ))}
      </ol>
      <figcaption className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" busy={busy} onClick={() => void download()}>
          {busy ? m.blocks.slidesView.making : m.blocks.slidesView.download}
        </Button>
        {failed && (
          <span role="status" className="text-sm text-danger">
            {m.blocks.slidesView.failed}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
