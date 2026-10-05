import { type FormEvent, useState } from 'react';
import { format, messages as m } from '../../i18n';
import { Button } from '../../ui/Button';
import { SelectField } from '../../ui/Field';
import { FieldError } from '../../ui/FieldError';
import { Link } from '../../ui/Link';
import { Modal } from '../../ui/modal';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { commonErrorMessage } from '../auth-errors';
import { parseSelectionKey, selectionKey } from '../providers/provider-text';
import { type Choice, modelOptions } from './models';

interface Props {
  title: string;
  lead: string;
  value: Choice;
  /** Text für „keine eigene Wahl“, z. B. „Wie im Fach“. */
  inheritLabel: string;
  /** Was dann gilt, falls etwas eingerichtet ist. */
  inheritedName: string | null;
  onSave: (choice: Choice) => Promise<void>;
  onClose: () => void;
}

const INHERIT = '';
const ENGINE_PREFIX = 'engine:';

/**
 * Auswahl für ein Fach oder einen Chat: ein Modell eines Anbieters oder ein Agent-Zugang (Claude Code).
 * „Keine Wahl“ lässt die übergeordnete Einstellung gelten.
 */
export function ModelDialog({
  title,
  lead,
  value,
  inheritLabel,
  inheritedName,
  onSave,
  onClose,
}: Props) {
  const { providers, engines } = useWorkspace();
  const d = m.chat.modelDialog;
  const options = modelOptions(providers);
  const profiles = engines.profiles;
  const initial = value.engineProfileId
    ? `${ENGINE_PREFIX}${value.engineProfileId}`
    : value.model
      ? selectionKey(value.model.providerId, value.model.model)
      : INHERIT;
  const [key, setKey] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (key === INHERIT) await onSave({ model: null, engineProfileId: null });
      else if (key.startsWith(ENGINE_PREFIX)) {
        await onSave({ model: null, engineProfileId: key.slice(ENGINE_PREFIX.length) });
      } else await onSave({ model: parseSelectionKey(key), engineProfileId: null });
      onClose();
    } catch (caught) {
      setError(commonErrorMessage(caught));
      setBusy(false);
    }
  }

  const inherit = inheritedName
    ? format(d.inheritWith, { label: inheritLabel, name: inheritedName })
    : format(d.inheritWithout, { label: inheritLabel });

  return (
    <Modal title={title} description={lead} onClose={onClose}>
      {options.length === 0 && profiles.length === 0 ? (
        <div className="space-y-1">
          <p className="text-ink-secondary">{d.none}</p>
          <Link to={{ name: 'settings' }} className="inline-flex min-h-11 items-center">
            {m.chat.openSettings}
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <SelectField
            label={d.label}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            data-autofocus
          >
            <option value={INHERIT}>{inherit}</option>
            {profiles.length > 0 && (
              <optgroup label={d.groupAgents}>
                {profiles.map((profile) => (
                  <option key={profile.id} value={`${ENGINE_PREFIX}${profile.id}`}>
                    {profile.name}
                  </option>
                ))}
              </optgroup>
            )}
            {options.length > 0 && (
              <optgroup label={d.groupModels}>
                {options.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                    {option.free ? ` · ${d.free}` : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </SelectField>
          {key.startsWith(ENGINE_PREFIX) && (
            <p className="text-sm text-ink-secondary">{d.agentHint}</p>
          )}
          {error && <FieldError>{error}</FieldError>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose}>
              {m.common.cancel}
            </Button>
            <Button type="submit" variant="primary" busy={busy}>
              {m.common.save}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
