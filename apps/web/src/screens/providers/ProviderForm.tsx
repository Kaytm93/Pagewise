import { type FormEvent, type ReactNode, useState } from 'react';
import type {
  ModelEntry,
  PresetId,
  Provider,
  ProviderPatch,
  ProviderPreset,
} from '../../api/types';
import { format, messages as m } from '../../i18n';
import { Button } from '../../ui/Button';
import { CheckField, SecretField, SelectField, TextField } from '../../ui/Field';
import { FieldError } from '../../ui/FieldError';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { ModelListEditor } from './ModelListEditor';
import {
  isCodingPlanUrl,
  isFreeModel,
  mapProviderError,
  type ProviderErrors,
} from './provider-text';

const toEntry = (model: ModelEntry): ModelEntry => ({
  id: model.id,
  vision: model.vision,
  tools: model.tools,
  reasoning: model.reasoning,
  streaming: model.streaming,
});

function Notice({ children }: { children: string }) {
  return (
    <p role="note" className="mt-3 rounded-box bg-paper p-3 text-sm text-ink-secondary">
      {children}
    </p>
  );
}

interface Props {
  /** Anbieter bearbeiten; ohne Angabe wird ein neuer angelegt. */
  provider?: Provider;
  presets: ProviderPreset[];
  /** Ausgewählte Voreinstellung beim Anlegen. */
  presetId?: PresetId;
  /** Zeigt die Auswahl der Voreinstellung im Formular (sonst legt der Aufrufer sie fest). */
  choosePreset?: boolean;
  submitLabel: string;
  onSaved: (provider: Provider) => void | Promise<void>;
  /** Läuft, wenn nichts zu speichern war (nur beim Bearbeiten). */
  onUnchanged?: () => void;
  onCancel?: () => void;
  /** Zusätzliche Aktionen links neben den Knöpfen (Löschen, Testen). */
  extraActions?: ReactNode;
}

/** Formular zum Anlegen und Bearbeiten eines Anbieters. */
export function ProviderForm({
  provider,
  presets,
  presetId = 'openrouter',
  choosePreset = false,
  submitLabel,
  onSaved,
  onUnchanged,
  onCancel,
  extraActions,
}: Props) {
  const { addProvider, editProvider } = useWorkspace();
  const [chosen, setChosen] = useState<PresetId>(provider?.preset ?? presetId);
  const preset = presets.find((entry) => entry.id === chosen);
  const [name, setName] = useState(provider?.name ?? m.providers.presets[presetId]);
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? preset?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [sendImages, setSendImages] = useState(provider?.sendImages ?? true);
  const [models, setModels] = useState<ModelEntry[]>(
    provider ? provider.models.map(toEntry) : (preset?.models ?? []),
  );
  const [errors, setErrors] = useState<ProviderErrors>({});
  const [busy, setBusy] = useState(false);
  const editing = provider !== undefined;
  const e = m.providers.errors;

  function pickPreset(id: PresetId) {
    const next = presets.find((entry) => entry.id === id);
    setChosen(id);
    setName(m.providers.presets[id]);
    setBaseUrl(next?.baseUrl ?? '');
    setModels(next?.models ?? []);
    // Ein Schlüssel gehört zu genau einem Anbieter und wird beim Wechsel nicht mitgenommen.
    setApiKey('');
    setErrors({});
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next: ProviderErrors = {};
    if (name.trim() === '') next.name = m.errors.invalidName;
    if (baseUrl.trim() === '') next.baseUrl = e.baseUrlRequired;
    if (!editing && preset?.requiresKey && apiKey.trim() === '') next.apiKey = e.keyRequired;
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      if (provider) {
        const patch: ProviderPatch = {};
        if (name.trim() !== provider.name) patch.name = name.trim();
        if (baseUrl.trim() !== provider.baseUrl) patch.baseUrl = baseUrl.trim();
        if (JSON.stringify(models) !== JSON.stringify(provider.models.map(toEntry))) {
          patch.models = models;
        }
        if (sendImages !== provider.sendImages) patch.sendImages = sendImages;
        if (apiKey.trim() !== '') patch.apiKey = apiKey.trim();
        else if (removeKey) patch.clearKey = true;
        if (Object.keys(patch).length === 0) {
          onUnchanged?.();
          return;
        }
        await onSaved(await editProvider(provider.id, patch));
      } else {
        await onSaved(
          await addProvider({
            name: name.trim(),
            preset: chosen,
            baseUrl: baseUrl.trim(),
            ...(apiKey.trim() !== '' ? { apiKey: apiKey.trim() } : {}),
            models,
            ...(sendImages ? {} : { sendImages: false }),
          }),
        );
      }
    } catch (caught) {
      setErrors(mapProviderError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {choosePreset && !editing && (
        <SelectField
          label={m.providers.form.preset}
          value={chosen}
          hint={m.providers.presetHints[chosen]}
          onChange={(event) => pickPreset(event.target.value as PresetId)}
        >
          {presets.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {m.providers.presets[entry.id]}
            </option>
          ))}
        </SelectField>
      )}
      <TextField
        label={m.providers.form.name}
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={errors.name}
        maxLength={80}
        autoComplete="off"
      />
      <TextField
        label={m.providers.form.baseUrl}
        hint={m.providers.form.baseUrlHint}
        value={baseUrl}
        onChange={(event) => setBaseUrl(event.target.value)}
        error={errors.baseUrl}
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      {isCodingPlanUrl(baseUrl) && <Notice>{m.providers.codingPlan}</Notice>}

      <div>
        <SecretField
          label={m.providers.form.apiKey}
          optional={!preset?.requiresKey}
          hint={editing ? m.providers.form.apiKeyHintEdit : m.providers.form.apiKeyHintCreate}
          showLabel={m.providers.form.showKey}
          hideLabel={m.providers.form.hideKey}
          value={apiKey}
          onChange={(event) => {
            setApiKey(event.target.value);
            if (event.target.value !== '') setRemoveKey(false);
          }}
          error={errors.apiKey}
        />
        {editing && provider.hasKey && (
          <p className="mt-2 text-sm text-ink-secondary">
            {provider.keyHint
              ? format(m.providers.keySetEnding, { last4: provider.keyHint })
              : m.providers.keySet}
            {' · '}
            <button
              type="button"
              aria-pressed={removeKey}
              onClick={() => {
                setRemoveKey((value) => !value);
                setApiKey('');
              }}
              className="min-h-11 text-accent underline underline-offset-2"
            >
              {removeKey ? m.providers.form.keepKey : m.providers.form.removeKey}
            </button>
          </p>
        )}
        {removeKey && (
          <p role="status" className="text-sm text-ink-secondary">
            {m.providers.form.keyRemoved}
          </p>
        )}
      </div>

      <fieldset className="min-w-0">
        <legend className="text-sm font-medium text-ink">{m.providers.form.models}</legend>
        <p className="mt-1 mb-3 text-sm text-ink-muted">{m.providers.form.modelsLead}</p>
        <ModelListEditor
          models={models}
          onChange={setModels}
          providerId={provider?.id}
          error={errors.models}
        />
        {models.some((model) => isFreeModel(model.id)) && <Notice>{m.providers.freeNotice}</Notice>}
      </fieldset>

      <section aria-labelledby="sent-title" className="rounded-box bg-paper p-4">
        <h3 id="sent-title" className="text-sm font-medium text-ink">
          {m.providers.form.sentTitle}
        </h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-secondary">
          <li>{m.providers.form.sentText}</li>
          <li>{m.providers.form.sentImages}</li>
          <li>{m.providers.form.sentNever}</li>
        </ul>
        <div className="mt-2">
          <CheckField
            label={m.providers.form.sendImages}
            hint={m.providers.form.sendImagesHint}
            checked={sendImages}
            onChange={setSendImages}
          />
        </div>
      </section>

      {errors.form && <FieldError>{errors.form}</FieldError>}
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end">
        {extraActions && (
          <div className="flex flex-col gap-2 sm:mr-auto sm:flex-row">{extraActions}</div>
        )}
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {m.common.cancel}
          </Button>
        )}
        <Button type="submit" variant="primary" busy={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
