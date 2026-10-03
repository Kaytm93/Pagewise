import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../../api/client';
import type { AvailableModel, ModelEntry } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { useSession } from '../../session/SessionProvider';
import { Button } from '../../ui/Button';
import { FieldError } from '../../ui/FieldError';
import { isFreeModel } from './provider-text';

const MAX_MODELS = 100;
const MAX_SHOWN = 50;
// Spiegelt die Regel des Servers: keine Leerzeichen oder Steuerzeichen, höchstens 200 Zeichen.
// biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst abgelehnt.
const VALID_ID = /^[^\s\u0000-\u001f\u007f]{1,200}$/;

const FLAGS = [
  ['vision', m.providers.models.vision],
  ['tools', m.providers.models.tools],
  ['reasoning', m.providers.models.reasoning],
] as const;

function Flag({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-secondary">
      <input
        type="checkbox"
        className="size-5 accent-primary"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

/** Liste der Modelle eines Anbieters mit Fähigkeiten, Hinzufügen von Hand und Laden vom Anbieter. */
export function ModelListEditor({
  models,
  onChange,
  providerId,
  error,
}: {
  models: ModelEntry[];
  onChange: (models: ModelEntry[]) => void;
  /** Gesetzt, wenn der Anbieter schon gespeichert ist; nur dann lässt sich die Liste laden. */
  providerId?: string;
  error?: string | null;
}) {
  const { api } = useSession();
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [available, setAvailable] = useState<AvailableModel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const e = m.providers.errors;

  function change(index: number, patch: Partial<ModelEntry>) {
    onChange(models.map((model, at) => (at === index ? { ...model, ...patch } : model)));
  }

  function add(entry: ModelEntry): boolean {
    if (!VALID_ID.test(entry.id)) {
      setDraftError(e.modelInvalid);
      return false;
    }
    if (models.some((model) => model.id === entry.id)) {
      setDraftError(e.modelDuplicate);
      return false;
    }
    if (models.length >= MAX_MODELS) {
      setDraftError(e.tooManyModels);
      return false;
    }
    setDraftError(null);
    onChange([...models, entry]);
    return true;
  }

  function addDraft() {
    const id = draft.trim();
    if (id === '') return;
    if (add({ id, vision: false, tools: false, reasoning: false, streaming: true })) setDraft('');
  }

  async function load() {
    if (!providerId) return;
    setLoading(true);
    setLoadError(null);
    try {
      setAvailable(await api.availableModels(providerId));
    } catch (caught) {
      setLoadError(
        caught instanceof ApiError && caught.code === 'network' ? m.errors.network : e.loadModels,
      );
    } finally {
      setLoading(false);
    }
  }

  const matches = (available ?? []).filter((model) =>
    model.id.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const shown = matches.slice(0, MAX_SHOWN);
  const has = (id: string) => models.some((model) => model.id === id);

  return (
    <div>
      {models.length === 0 ? (
        <p className="rounded-box bg-paper p-3 text-sm text-ink-secondary">
          {m.providers.models.none}
        </p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {models.map((model, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: die Kennung ist bearbeitbar und taugt nicht als Schlüssel
              key={index}
              className="py-2"
            >
              <fieldset className="min-w-0">
                <legend className="sr-only">{model.id || m.providers.models.id}</legend>
                <div className="flex items-center gap-2">
                  <input
                    aria-label={m.providers.models.id}
                    value={model.id}
                    onChange={(event) => change(index, { id: event.target.value.trim() })}
                    maxLength={200}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="min-h-11 min-w-0 flex-1 rounded-control border border-control-edge bg-canvas px-3 text-base text-ink"
                  />
                  <button
                    type="button"
                    onClick={() => onChange(models.filter((_, at) => at !== index))}
                    aria-label={format(m.providers.models.remove, { id: model.id })}
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-paper hover:text-ink"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-4">
                  {FLAGS.map(([key, label]) => (
                    <Flag
                      key={key}
                      label={label}
                      checked={model[key]}
                      onChange={(value) => change(index, { [key]: value })}
                    />
                  ))}
                  {isFreeModel(model.id) && (
                    <span className="text-meta text-ink-muted">{m.providers.models.free}</span>
                  )}
                </div>
              </fieldset>
            </li>
          ))}
        </ul>
      )}
      {error && <FieldError>{error}</FieldError>}

      <div className="mt-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <input
            aria-label={m.providers.models.add}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setDraftError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addDraft();
              }
            }}
            maxLength={200}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="min-h-11 w-full rounded-control border border-control-edge bg-canvas px-3 text-base text-ink"
          />
          {draftError && <FieldError>{draftError}</FieldError>}
        </div>
        <Button variant="secondary" onClick={addDraft} disabled={draft.trim() === ''}>
          {m.providers.models.add}
        </Button>
      </div>

      <div className="mt-3">
        {providerId ? (
          <Button variant="secondary" busy={loading} onClick={() => void load()}>
            {loading ? m.providers.models.loading : m.providers.models.load}
          </Button>
        ) : (
          <p className="text-sm text-ink-muted">{m.providers.models.loadFirst}</p>
        )}
        {loadError && <FieldError>{loadError}</FieldError>}
      </div>

      {available && (
        <div className="mt-2 rounded-box border border-line p-3">
          <input
            aria-label={m.providers.models.filter}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="min-h-11 w-full rounded-control border border-control-edge bg-canvas px-3 text-base text-ink"
          />
          {shown.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">{m.providers.models.noMatches}</p>
          ) : (
            <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto">
              {shown.map((model) => (
                <li key={model.id} className="flex items-center justify-between gap-3 py-1">
                  <span className="min-w-0 break-all text-sm">
                    {model.id}
                    {model.free && (
                      <span className="ml-2 text-meta text-ink-muted">
                        {m.providers.models.free}
                      </span>
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    className="shrink-0"
                    disabled={has(model.id)}
                    aria-label={format(m.providers.models.take, { id: model.id })}
                    onClick={() =>
                      add({
                        id: model.id,
                        vision: model.vision ?? false,
                        tools: model.tools ?? false,
                        reasoning: model.reasoning ?? false,
                        streaming: true,
                      })
                    }
                  >
                    {has(model.id) ? m.providers.models.taken : m.common.add}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {matches.length > MAX_SHOWN && (
            <p className="mt-2 text-meta text-ink-muted">
              {format(m.providers.models.limited, { count: MAX_SHOWN })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
