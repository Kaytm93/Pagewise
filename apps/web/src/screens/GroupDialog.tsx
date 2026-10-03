import { type FormEvent, useId, useState } from 'react';
import { ApiError } from '../api/client';
import type { Group, Subject } from '../api/types';
import { format, messages as m } from '../i18n';
import { navigate } from '../router';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { TextField } from '../ui/Field';
import { FieldError } from '../ui/FieldError';
import { Modal } from '../ui/modal';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { commonErrorMessage } from './auth-errors';

type Errors = { name?: string; kind?: string; form?: string };

function mapError(error: unknown): Errors {
  const e = m.groupDialog.errors;
  if (error instanceof ApiError) {
    if (error.code === 'name_taken') return { name: e.nameTaken };
    if (error.code === 'not_found') return { form: e.notFound };
    if (error.code === 'invalid_input') {
      if (error.details.field === 'name') return { name: m.errors.invalidName };
      if (error.details.field === 'kind') return { kind: m.errors.invalidText };
    }
  }
  return { form: commonErrorMessage(error) };
}

/** Untergruppe anlegen (ohne `group`) oder bearbeiten, samt Löschen mit Rückfrage. */
export function GroupDialog({
  subject,
  group,
  onClose,
}: {
  subject: Subject;
  group?: Group;
  onClose: () => void;
}) {
  const { addGroup, editGroup, removeGroup } = useWorkspace();
  const [name, setName] = useState(group?.name ?? '');
  const [kind, setKind] = useState(group?.kind ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const listId = useId();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === '') return setErrors({ name: m.errors.invalidName });
    setErrors({});
    setBusy(true);
    try {
      const input = { name: name.trim(), kind: kind.trim() || null };
      if (group) await editGroup(group.id, input);
      else {
        const created = await addGroup(subject.id, input);
        navigate({ name: 'subject', subjectId: subject.id, groupId: created.id });
      }
      onClose();
    } catch (caught) {
      setErrors(mapError(caught));
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!group) return;
    setBusy(true);
    try {
      await removeGroup(group.id);
      navigate({ name: 'subject', subjectId: subject.id, groupId: null });
      onClose();
    } catch (caught) {
      setConfirmDelete(false);
      setErrors(mapError(caught));
      setBusy(false);
    }
  }

  return (
    <>
      <Modal title={group ? m.groupDialog.editTitle : m.groupDialog.createTitle} onClose={onClose}>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <TextField
            label={m.groupDialog.name}
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={errors.name}
            maxLength={80}
            autoComplete="off"
            data-autofocus
          />
          <TextField
            label={m.groupDialog.kind}
            hint={m.groupDialog.kindHint}
            optional
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            error={errors.kind}
            maxLength={80}
            autoComplete="off"
            list={listId}
          />
          <datalist id={listId}>
            {m.groupDialog.suggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
          {errors.form && <FieldError>{errors.form}</FieldError>}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            {group && (
              <Button
                variant="danger"
                className="sm:mr-auto"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
              >
                {m.groupDialog.delete}
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
      {confirmDelete && group && (
        <ConfirmDialog
          title={format(m.confirm.deleteGroupTitle, { name: group.name })}
          description={m.confirm.deleteGroupBody}
          confirmLabel={m.common.delete}
          busy={busy}
          onConfirm={() => void onDelete()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
