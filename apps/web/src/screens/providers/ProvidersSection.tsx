import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import type { Provider } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { Button } from '../../ui/Button';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { ModelChoice } from './ModelChoice';
import { ProviderDialog } from './ProviderDialog';
import { hostOf } from './provider-text';

function keyState(provider: Provider): string {
  if (!provider.hasKey) return m.providers.keyMissing;
  return provider.keyHint
    ? format(m.providers.keySetEnding, { last4: provider.keyHint })
    : m.providers.keySet;
}

function modelCount(provider: Provider): string {
  return provider.models.length === 1
    ? m.providers.modelCountOne
    : format(m.providers.modelCount, { count: provider.models.length });
}

type Dialog = { provider?: Provider } | null;

/** Anbieter verwalten und Standardmodell wählen. Schlüssel werden nie angezeigt. */
export function ProvidersSection() {
  const { providers } = useWorkspace();
  const [dialog, setDialog] = useState<Dialog>(null);

  return (
    <div>
      {providers.length === 0 ? (
        <div className="rounded-box bg-paper p-4">
          <p className="font-medium">{m.providers.empty}</p>
          <p className="mt-1 text-sm text-ink-secondary">{m.providers.emptyHint}</p>
        </div>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {providers.map((provider) => (
            <li key={provider.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1 py-3">
                <p className="truncate font-medium">{provider.name}</p>
                <p className="truncate text-meta text-ink-muted">
                  {hostOf(provider.baseUrl)} · {keyState(provider)} · {modelCount(provider)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDialog({ provider })}
                aria-label={format(m.providers.editNamed, { name: provider.name })}
                className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-paper hover:text-ink"
              >
                <Pencil aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" className="mt-4" onClick={() => setDialog({})}>
        <Plus aria-hidden="true" className="size-4" />
        {m.providers.add}
      </Button>

      {providers.length > 0 && (
        <div className="mt-8">
          <h3 className="font-medium">{m.providers.choice.title}</h3>
          <div className="mt-4">
            <ModelChoice />
          </div>
        </div>
      )}

      {dialog && <ProviderDialog provider={dialog.provider} onClose={() => setDialog(null)} />}
    </div>
  );
}
