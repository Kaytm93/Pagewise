import { CircleCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PresetId, Provider, ProviderPreset, TestOutcome } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { useSession } from '../../session/SessionProvider';
import { Button } from '../../ui/Button';
import { FieldError } from '../../ui/FieldError';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { commonErrorMessage } from '../auth-errors';
import { ProviderDialog } from '../providers/ProviderDialog';
import { ProviderForm } from '../providers/ProviderForm';
import { testMessage } from '../providers/provider-text';
import { StepFrame } from './StepFrame';

const CHOICES: PresetId[] = ['openrouter', 'zai', 'ollama', 'lmstudio', 'custom'];

/** Schritt „Anbieter“: auswählen, Schlüssel eintragen, anlegen, testen. Lässt sich überspringen. */
export function ProviderStep({
  step,
  total,
  onBack,
  onNext,
}: {
  step: number;
  total: number;
  onBack: () => void;
  onNext: () => void;
}) {
  const { api } = useSession();
  const [presets, setPresets] = useState<ProviderPreset[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preset, setPreset] = useState<PresetId>('openrouter');
  const [created, setCreated] = useState<Provider | null>(null);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const { providers } = useWorkspace();
  // Nach dem Bearbeiten gilt der aktuelle Stand aus dem Workspace, nicht der beim Anlegen.
  const shown = created ? (providers.find((entry) => entry.id === created.id) ?? created) : null;

  useEffect(() => {
    let cancelled = false;
    api
      .providerPresets()
      .then((list) => {
        if (!cancelled) setPresets(list);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setLoadError(commonErrorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function test(provider: Provider) {
    setTesting(true);
    setOutcome(null);
    setTestError(null);
    try {
      setOutcome(await api.testProvider(provider.id));
    } catch (caught) {
      setTestError(commonErrorMessage(caught));
    } finally {
      setTesting(false);
    }
  }

  async function onCreated(provider: Provider) {
    setCreated(provider);
    await test(provider);
  }

  return (
    <StepFrame
      step={step}
      total={total}
      title={m.onboarding.provider.title}
      lead={m.onboarding.provider.lead}
    >
      {loadError && <FieldError>{loadError}</FieldError>}

      {presets && !created && (
        <>
          <fieldset>
            <legend className="text-sm font-medium text-ink">{m.providers.form.preset}</legend>
            <ul className="mt-2 divide-y divide-line border-y border-line">
              {CHOICES.map((id) => (
                <li key={id}>
                  <label
                    htmlFor={`preset-${id}`}
                    className="flex min-h-14 cursor-pointer items-start gap-3 py-3"
                  >
                    <input
                      id={`preset-${id}`}
                      type="radio"
                      name="preset"
                      className="mt-0.5 size-5 accent-primary"
                      checked={preset === id}
                      onChange={() => setPreset(id)}
                    />
                    <span>
                      <span className="block font-medium">{m.providers.presets[id]}</span>
                      <span className="block text-sm text-ink-secondary">
                        {m.providers.presetHints[id]}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="mt-6">
            <ProviderForm
              key={preset}
              presets={presets}
              presetId={preset}
              submitLabel={m.onboarding.provider.create}
              onSaved={onCreated}
            />
          </div>
        </>
      )}

      {created && shown && (
        <div className="rounded-box border border-line p-4">
          <p className="font-medium">
            {format(m.onboarding.provider.createdAs, { name: shown.name })}
          </p>
          {outcome &&
            (outcome.ok ? (
              <p role="status" className="mt-1 flex items-start gap-1.5 text-sm text-ink-secondary">
                <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>{testMessage(outcome)}</span>
              </p>
            ) : (
              <FieldError>{testMessage(outcome)}</FieldError>
            ))}
          {testing && (
            <p role="status" className="mt-1 text-sm text-ink-secondary">
              {m.providers.form.testing}
            </p>
          )}
          {testError && <FieldError>{testError}</FieldError>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" busy={testing} onClick={() => void test(created)}>
              {m.onboarding.provider.retest}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {m.common.edit}
            </Button>
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onBack}>
          {m.common.back}
        </Button>
        {created ? (
          <Button variant="primary" onClick={onNext}>
            {m.common.next}
          </Button>
        ) : (
          <Button variant="ghost" onClick={onNext}>
            {m.common.skip}
          </Button>
        )}
      </div>

      {editing && created && <EditCreated id={created.id} onClose={() => setEditing(false)} />}
    </StepFrame>
  );
}

/** Öffnet den Bearbeiten-Dialog mit dem aktuellen Stand des Anbieters aus dem Workspace. */
function EditCreated({ id, onClose }: { id: string; onClose: () => void }) {
  const { providers } = useWorkspace();
  const provider = providers.find((entry) => entry.id === id);
  if (!provider) return null;
  return <ProviderDialog provider={provider} onClose={onClose} />;
}
