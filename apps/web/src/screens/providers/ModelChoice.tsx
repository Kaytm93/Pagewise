import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ModelSettings, Provider, Selection } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { Button } from '../../ui/Button';
import { SelectField } from '../../ui/Field';
import { FieldError } from '../../ui/FieldError';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { commonErrorMessage } from '../auth-errors';
import { parseSelectionKey, selectionKey } from './provider-text';

const MAX_FALLBACKS = 5;
const NONE = '';

function toKey(selection: Selection | null): string {
  return selection ? selectionKey(selection.providerId, selection.model) : NONE;
}

function fromKey(key: string): Selection | null {
  return key === NONE ? null : parseSelectionKey(key);
}

function Options({ providers }: { providers: Provider[] }) {
  return (
    <>
      {providers.flatMap((provider) =>
        provider.models.map((model) => (
          <option key={`${provider.id}|${model.id}`} value={selectionKey(provider.id, model.id)}>
            {provider.name} · {model.id}
            {model.free ? ` · ${m.providers.models.free}` : ''}
          </option>
        )),
      )}
    </>
  );
}

/** Standardmodell und Kette von Ausweichmodellen. Gespeichert wird erst mit dem Knopf. */
export function ModelChoice() {
  const { providers, modelSettings, saveModelSettings } = useWorkspace();
  const [defaultKey, setDefaultKey] = useState(toKey(modelSettings.default));
  const [fallbackKeys, setFallbackKeys] = useState(modelSettings.fallback.map(toKey));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = m.providers.choice;

  // Der Server räumt die Wahl auf, wenn ein Anbieter oder Modell entfällt: den Stand dann übernehmen.
  useEffect(() => {
    setDefaultKey(toKey(modelSettings.default));
    setFallbackKeys(modelSettings.fallback.map(toKey));
  }, [modelSettings]);

  const hasModels = useMemo(
    () => providers.some((provider) => provider.models.length > 0),
    [providers],
  );
  if (!hasModels) return <p className="text-ink-secondary">{c.noModels}</p>;

  const touched = () => setSaved(false);

  async function save() {
    setBusy(true);
    setError(null);
    const next: ModelSettings = {
      default: fromKey(defaultKey),
      fallback: fallbackKeys.flatMap((key) => {
        const selection = fromKey(key);
        return selection ? [selection] : [];
      }),
    };
    try {
      await saveModelSettings(next);
      setSaved(true);
    } catch (caught) {
      setError(commonErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SelectField
        label={c.default}
        hint={c.lead}
        value={defaultKey}
        onChange={(event) => {
          setDefaultKey(event.target.value);
          touched();
        }}
      >
        <option value={NONE}>{c.none}</option>
        <Options providers={providers} />
      </SelectField>

      <fieldset>
        <legend className="text-sm font-medium text-ink">{c.fallback}</legend>
        <p className="mt-1 text-sm text-ink-muted">{c.fallbackLead}</p>
        {fallbackKeys.length === 0 ? (
          <p className="mt-3 text-sm text-ink-secondary">{c.fallbackNone}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {fallbackKeys.map((key, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: die Reihenfolge ist die Information, Einträge haben keine eigene Kennung
              <li key={index} className="flex items-end gap-2">
                <SelectField
                  className="min-w-0 flex-1"
                  label={format(c.fallbackSlot, { number: index + 1 })}
                  hideLabel
                  value={key}
                  onChange={(event) => {
                    setFallbackKeys((current) =>
                      current.map((entry, at) => (at === index ? event.target.value : entry)),
                    );
                    touched();
                  }}
                >
                  <Options providers={providers} />
                </SelectField>
                <button
                  type="button"
                  aria-label={format(c.removeFallback, { number: index + 1 })}
                  onClick={() => {
                    setFallbackKeys((current) => current.filter((_, at) => at !== index));
                    touched();
                  }}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-paper hover:text-ink"
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {fallbackKeys.length < MAX_FALLBACKS && (
          <Button
            variant="ghost"
            className="mt-2 -ml-3"
            onClick={() => {
              const first = providers.flatMap((provider) =>
                provider.models.map((model) => selectionKey(provider.id, model.id)),
              )[0];
              if (first) setFallbackKeys((current) => [...current, first]);
              touched();
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
            {c.addFallback}
          </Button>
        )}
      </fieldset>

      {error && <FieldError>{error}</FieldError>}
      <div className="flex items-center gap-4">
        <Button variant="secondary" busy={busy} onClick={() => void save()}>
          {c.save}
        </Button>
        {saved && (
          <p role="status" className="text-sm text-ink-secondary">
            {c.saved}
          </p>
        )}
      </div>
    </div>
  );
}
