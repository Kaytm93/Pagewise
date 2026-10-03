import { type FormEvent, useState } from 'react';
import type { Selection } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { Button } from '../../ui/Button';
import { SelectField } from '../../ui/Field';
import { FieldError } from '../../ui/FieldError';
import { Modal } from '../../ui/modal';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { commonErrorMessage } from '../auth-errors';
import { parseSelectionKey, selectionKey } from '../providers/provider-text';
import { modelOptions } from './models';

interface Props {
  title: string;
  lead: string;
  value: Selection | null;
  /** Text für „keine eigene Wahl“, z. B. „Wie im Fach“. */
  inheritLabel: string;
  /** Welches Modell dann gilt, falls eines eingerichtet ist. */
  inheritedName: string | null;
  onSave: (selection: Selection | null) => Promise<void>;
  onClose: () => void;
}

const INHERIT = '';

/** Auswahl eines Modells für ein Fach oder einen Chat; „keine Wahl“ lässt die übergeordnete Einstellung gelten. */
export function ModelDialog({
  title,
  lead,
  value,
  inheritLabel,
  inheritedName,
  onSave,
  onClose,
}: Props) {
  const { providers } = useWorkspace();
  const d = m.chat.modelDialog;
  const options = modelOptions(providers);
  const [key, setKey] = useState(value ? selectionKey(value.providerId, value.model) : INHERIT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave(key === INHERIT ? null : parseSelectionKey(key));
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
      {options.length === 0 ? (
        <p className="text-ink-secondary">{d.none}</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <SelectField
            label={d.label}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            data-autofocus
          >
            <option value={INHERIT}>{inherit}</option>
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
                {option.free ? ` · ${d.free}` : ''}
              </option>
            ))}
          </SelectField>
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
