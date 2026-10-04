import { type FormEvent, useState } from 'react';
import type { EngineKind, EngineProfile } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { SecretField, SelectField, TextField } from '../../ui/Field';
import { FieldError } from '../../ui/FieldError';
import { Modal } from '../../ui/modal';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { type EngineErrors, kindLabel, mapEngineError, tokenState } from './engine-text';

const KINDS: EngineKind[] = ['claude-subscription', 'glm-coding-plan', 'anthropic-api'];

/** Zugang für die Agent-CLI anlegen (ohne `profile`) oder bearbeiten, samt Löschen mit Rückfrage. */
export function EngineDialog({
  profile,
  onClose,
}: {
  profile?: EngineProfile;
  onClose: () => void;
}) {
  const { engines, addEngine, editEngine, removeEngine } = useWorkspace();
  const editing = profile !== undefined;
  const [kind, setKind] = useState<EngineKind>(profile?.kind ?? 'claude-subscription');
  const [name, setName] = useState(profile?.name ?? m.agents.defaultNames['claude-subscription']);
  const [nameEdited, setNameEdited] = useState(editing);
  const [model, setModel] = useState(profile?.model ?? '');
  const [token, setToken] = useState('');
  const [timeout, setTimeoutValue] = useState(String(profile?.timeoutMinutes ?? 20));
  const [errors, setErrors] = useState<EngineErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const info = engines.kinds.find((entry) => entry.kind === kind);
  const needsToken = info?.needsToken ?? false;

  function chooseKind(next: EngineKind) {
    setKind(next);
    setToken('');
    // Solange der Name nicht von Hand geändert wurde, folgt er der Art.
    if (!nameEdited) setName(m.agents.defaultNames[next]);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next: EngineErrors = {};
    if (name.trim() === '') next.name = m.errors.invalidName;
    const minutes = Number(timeout);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
      next.timeout = m.agents.errors.invalidTimeout;
    }
    if (!editing && needsToken && token.trim() === '') next.token = m.agents.errors.tokenRequired;
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      const base = {
        name: name.trim(),
        model: model.trim() === '' ? null : model.trim(),
        timeoutMinutes: minutes,
      };
      if (profile) {
        await editEngine(profile.id, { ...base, ...(token.trim() ? { token: token.trim() } : {}) });
      } else {
        await addEngine({ kind, ...base, ...(needsToken ? { token: token.trim() } : {}) });
      }
      onClose();
    } catch (caught) {
      setErrors(mapEngineError(caught));
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!profile) return;
    setBusy(true);
    try {
      await removeEngine(profile.id);
      onClose();
    } catch (caught) {
      setConfirmDelete(false);
      setErrors(mapEngineError(caught));
      setBusy(false);
    }
  }

  const modelHint = info?.defaultModel
    ? format(m.agents.form.modelHintDefault, { model: info.defaultModel })
    : m.agents.form.modelHint;

  return (
    <>
      <Modal
        wide
        title={editing ? m.agents.form.editTitle : m.agents.form.createTitle}
        onClose={onClose}
      >
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {editing ? (
            <div>
              <p className="text-sm font-medium text-ink">{m.agents.form.kind}</p>
              <p className="mt-1.5">{kindLabel(kind)}</p>
            </div>
          ) : (
            <SelectField
              label={m.agents.form.kind}
              value={kind}
              onChange={(event) => chooseKind(event.target.value as EngineKind)}
              data-autofocus
            >
              {KINDS.map((entry) => (
                <option key={entry} value={entry}>
                  {kindLabel(entry)}
                </option>
              ))}
            </SelectField>
          )}
          <p role="note" className="rounded-box bg-paper p-3 text-sm text-ink-secondary">
            {m.agents.kindHints[kind]}
            {info?.endpoint && <> {format(m.agents.form.endpoint, { url: info.endpoint })}</>}
          </p>

          <TextField
            label={m.agents.form.name}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setNameEdited(true);
            }}
            error={errors.name}
            maxLength={80}
            autoComplete="off"
          />
          {needsToken && (
            <SecretField
              label={m.agents.form.token}
              hint={editing ? m.agents.form.tokenHintEdit : m.agents.form.tokenHintCreate}
              showLabel={m.agents.form.showToken}
              hideLabel={m.agents.form.hideToken}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              error={errors.token}
            />
          )}
          {editing && profile && tokenState(profile) && (
            <p className="-mt-2 text-sm text-ink-secondary">{tokenState(profile)}</p>
          )}
          <TextField
            label={m.agents.form.model}
            optional
            hint={modelHint}
            placeholder={info?.defaultModel ?? ''}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            error={errors.model}
            maxLength={64}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <TextField
            label={m.agents.form.timeout}
            hint={m.agents.form.timeoutHint}
            type="number"
            inputMode="numeric"
            min={1}
            max={120}
            value={timeout}
            onChange={(event) => setTimeoutValue(event.target.value)}
            error={errors.timeout}
            className="max-w-64"
          />

          {errors.form && <FieldError>{errors.form}</FieldError>}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            {editing && (
              <Button
                variant="danger"
                className="sm:mr-auto"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
              >
                {m.agents.form.delete}
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              {m.common.cancel}
            </Button>
            <Button type="submit" variant="primary" busy={busy}>
              {m.common.save}
            </Button>
          </div>
        </form>
      </Modal>
      {confirmDelete && profile && (
        <ConfirmDialog
          title={format(m.agents.confirmDelete.title, { name: profile.name })}
          description={m.agents.confirmDelete.body}
          confirmLabel={m.common.delete}
          busy={busy}
          onConfirm={() => void onDelete()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
