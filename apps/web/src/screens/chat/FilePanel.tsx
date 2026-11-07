import { Download, File, FileImage, FileSpreadsheet, FileText, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ChatAsset, ChatFileEntry } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { useSession } from '../../session/SessionProvider';
import { Button } from '../../ui/Button';
import { Tabs } from '../../ui/Tabs';
import { formatSize } from './format-size';

type Load =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; files: ChatFileEntry[]; truncated: boolean };

/**
 * Art-Symbol einer Datei nach ihrer Endung. Der Umfang folgt dem der bestehenden Asset-Route
 * (`apps/server/src/agents/assets.ts`, TYPES): Tabellen (xlsx, csv), Bilder (png, jpg, jpeg, gif,
 * webp, svg), Text und PDF (pdf, txt, md), alles andere das allgemeine Datei-Symbol.
 */
function FileIcon({ extension }: { extension: string }) {
  const Icon = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)
    ? FileImage
    : ['xlsx', 'csv'].includes(extension)
      ? FileSpreadsheet
      : ['pdf', 'txt', 'md'].includes(extension)
        ? FileText
        : File;
  return <Icon aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />;
}

/**
 * Download-Adresse einer Arbeitsordner-Datei über die bestehende Asset-Route: Der Chat-Verlauf nennt
 * zu jeder vom Agenten erzeugten Datei ihren Asset-Datensatz (`message.assets`, übernommen mit
 * `takeover`); stimmen Name und Größe überein, liefert `/api/assets/:id/download` genau diese Datei
 * aus (gleiche Herkunft, Anmeldung per Cookie, `Content-Disposition: attachment`). Stimmt kein Eintrag,
 * gibt es keinen Knopf — für Arbeitsordner-Dateien wird nie ein eigener Endpoint erfunden (das wäre
 * eine eigene Sicherheitsentscheidung); diese Lücke steht im Bericht.
 */
function downloadOf(file: ChatFileEntry, assets: ChatAsset[]): string | null {
  return assets.find((asset) => asset.name === file.name && asset.size === file.size)?.id ?? null;
}

function FileRow({ file, assets }: { file: ChatFileEntry; assets: ChatAsset[] }) {
  const assetId = downloadOf(file, assets);
  return (
    <li className="flex min-h-11 min-w-0 items-center gap-2 rounded-control px-1">
      <FileIcon extension={file.extension} />
      {/* Der volle Name steht im `title`, die Zeile kürzt am Ende (wie in AssetList). */}
      <span title={file.name} className="min-w-0 truncate text-sm">
        {file.name}
      </span>
      <span className="ml-auto shrink-0 text-meta text-ink-muted">{formatSize(file.size)}</span>
      {assetId ? (
        <a
          href={`/api/assets/${assetId}/download`}
          download={file.name}
          title={format(m.chat.files.download, { name: file.name, size: formatSize(file.size) })}
          className="mo-press inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-paper hover:text-ink"
        >
          <Download aria-hidden="true" className="size-4" />
        </a>
      ) : (
        <span aria-hidden="true" className="inline-flex size-11 shrink-0" />
      )}
    </li>
  );
}

/**
 * Datei-Panel rechts im Chat (D-106, H-C02): flache Liste des Chat-Arbeitsordners mit Name, Größe und
 * Art-Symbol, truncated-Hinweis, Leer-, Lade- und Fehlerzustand. Die Reiter-Grundlage ist schon da;
 * funktional ist nur „Dateien“ — die Vorschau kommt mit H-C03 in einem eigenen Worktree.
 */
export function FilePanel({ chatId }: { chatId: string }) {
  const { api } = useSession();
  const [tab, setTab] = useState<'files' | 'preview'>('files');
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  // Assets des Chat-Verlaufs: nur sie lassen sich über die bestehende Route herunterladen.
  const [assets, setAssets] = useState<ChatAsset[]>([]);

  // Neu laden auf Knopfdruck: der Schlüssel zählt mit, ohne selbst gelesen zu werden (biome: bewusst).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey löst gezielt eine neue Ladung aus
  useEffect(() => {
    let cancelled = false;
    setLoad({ state: 'loading' });
    api
      .chatFiles(chatId)
      .then((reply) => {
        if (!cancelled) setLoad({ state: 'ready', files: reply.files, truncated: reply.truncated });
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [api, chatId, reloadKey]);

  // Der Verlauf liefert die Asset-IDs für die Download-Knöpfe; lädt die Liste neu, ebenfalls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey löst gezielt eine neue Ladung aus
  useEffect(() => {
    let cancelled = false;
    api
      .chat(chatId)
      .then((detail) => {
        if (!cancelled) setAssets(detail.messages.flatMap((message) => message.assets));
      })
      .catch(() => {
        // Der Verlauf ist Nebensache der Liste; scheitert er, bleiben alle Knöpfe verborgen.
        if (!cancelled) setAssets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api, chatId, reloadKey]);

  return (
    <section aria-label={m.chat.files.panel} className="flex min-h-0 flex-col">
      <Tabs
        label={m.chat.files.tabs}
        tabs={[
          { value: 'files', label: m.chat.files.tabFiles },
          { value: 'preview', label: m.chat.files.tabPreview },
        ]}
        value={tab}
        onChange={setTab}
        className="px-3"
        panel={
          tab === 'files' ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {load.state === 'loading' && (
                <p role="status" className="text-sm text-ink-secondary">
                  {m.chat.files.loading}
                </p>
              )}
              {load.state === 'failed' && (
                <div className="space-y-2">
                  <p className="text-sm text-danger">{m.chat.files.loadFailed}</p>
                  <Button variant="secondary" onClick={() => setReloadKey((key) => key + 1)}>
                    <RefreshCw aria-hidden="true" className="size-4" />
                    {m.common.retry}
                  </Button>
                </div>
              )}
              {load.state === 'ready' && (
                <>
                  {load.files.length === 0 ? (
                    <p className="text-sm text-ink-secondary">{m.chat.files.empty}</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {load.files.map((file) => (
                        <FileRow key={file.name} file={file} assets={assets} />
                      ))}
                    </ul>
                  )}
                  {load.truncated && (
                    <p className="mt-2 text-meta text-ink-muted">{m.chat.files.truncatedHint}</p>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <p className="text-sm text-ink-secondary">{m.chat.files.previewTabComing}</p>
            </div>
          )
        }
      />
    </section>
  );
}
