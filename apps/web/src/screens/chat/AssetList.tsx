import { Download, File, FileImage, FileText } from 'lucide-react';
import type { ChatAsset } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { formatSize } from './format-size';

/** Endung eines Dateinamens samt Punkt („ Hausaufgabe.pdf“ → „.pdf“); ohne Endung: leerer Text. */
function getExtension(name: string): string {
  const index = name.lastIndexOf('.');
  if (index <= 0 || index === name.length - 1) return '';
  return name.slice(index);
}

function AssetIcon({ kind }: { kind: ChatAsset['kind'] }) {
  const Icon = kind === 'image' ? FileImage : kind === 'text' || kind === 'pdf' ? FileText : File;
  return <Icon aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />;
}

/** Dateien, die ein Agent erzeugt hat, als Downloads. Der Server liefert sie nur als Anhang aus. */
export function AssetList({ assets, url }: { assets: ChatAsset[]; url: (id: string) => string }) {
  if (assets.length === 0) return null;
  return (
    <section aria-label={m.chat.agent.files} className="mt-3">
      <ul className="flex flex-wrap gap-2">
        {assets.map((asset) => (
          <li key={asset.id} className="min-w-0 max-w-full">
            <a
              href={url(asset.id)}
              download={asset.name}
              title={asset.name}
              aria-label={format(m.chat.agent.download, {
                name: asset.name,
                size: formatSize(asset.size),
              })}
              className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-control border border-line bg-paper px-3 text-sm text-ink no-underline hover:border-ink-muted"
            >
              <AssetIcon kind={asset.kind} />
              {/* Der Name kürzt am Anfang nicht, die Endung bleibt immer sichtbar: Regie nimmt dem
              Namen Platz weg, nicht der Endung. Der volle Name steht im `title`. */}
              <span className="min-w-0 truncate">{asset.name}</span>
              <span className="shrink-0 text-meta text-ink-muted">
                {getExtension(asset.name)}
                {formatSize(asset.size)}
              </span>
              <Download aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
