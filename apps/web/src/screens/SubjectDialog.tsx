import { type FormEvent, useState } from 'react';
import { ApiError } from '../api/client';
import type { Subject } from '../api/types';
import { format, messages as m } from '../i18n';
import { navigate } from '../router';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { TextField } from '../ui/Field';
import { FieldError } from '../ui/FieldError';
import { IconPicker } from '../ui/IconPicker';
import { Modal } from '../ui/modal';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { commonErrorMessage } from './auth-errors';

type Errors = { name?: string; teacher?: string; hours?: string; form?: string };

function mapError(error: unknown): Errors {
  const e = m.subjectDialog.errors;
  if (error instanceof ApiError) {
    if (error.code === 'name_taken') return { name: e.nameTaken };
    if (error.code === 'not_found') return { form: e.notFound };
    if (error.code === 'invalid_input') {
      if (error.details.field === 'name') return { name: m.errors.invalidName };
      if (error.details.field === 'teacher') return { teacher: m.errors.invalidText };
      if (error.details.field === 'hoursPerWeek') return { hours: e.invalidHours };
    }
  }
  return { form: commonErrorMessage(error) };
}

/** Fach anlegen (ohne `subject`) oder bearbeiten, samt Löschen mit Rückfrage. */
export function SubjectDialog({ subject, onClose }: { subject?: Subject; onClose: () => void }) {
  const { addSubject, editSubject, removeSubject } = useWorkspace();
  const [name, setName] = useState(subject?.name ?? '');
  const [teacher, setTeacher] = useState(subject?.teacher ?? '');
  const [hours, setHours] = useState(subject?.hoursPerWeek ? String(subject.hoursPerWeek) : '');
  const [icon, setIcon] = useState(subject?.icon ?? 'book');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next: Errors = {};
    if (name.trim() === '') next.name = m.errors.invalidName;
    const trimmedHours = hours.trim();
    let hoursPerWeek: number | null = null;
    if (trimmedHours !== '') {
      hoursPerWeek = Number(trimmedHours);
      if (!Number.isInteger(hoursPerWeek) || hoursPerWeek < 1 || hoursPerWeek > 40) {
        next.hours = m.subjectDialog.errors.invalidHours;
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      const input = { name: name.trim(), teacher: teacher.trim() || null, hoursPerWeek, icon };
      if (subject) {
        await editSubject(subject.id, input);
      } else {
        const created = await addSubject(input);
        navigate({ name: 'subject', subjectId: created.id, groupId: null });
      }
      onClose();
    } catch (caught) {
      setErrors(mapError(caught));
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!subject) return;
    setBusy(true);
    try {
      await removeSubject(subject.id);
      navigate({ name: 'home' });
      onClose();
    } catch (caught) {
      setConfirmDelete(false);
      setErrors(mapError(caught));
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        title={subject ? m.subjectDialog.editTitle : m.subjectDialog.createTitle}
        onClose={onClose}
      >
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <TextField
            label={m.subjectDialog.name}
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={errors.name}
            maxLength={80}
            autoComplete="off"
            data-autofocus
          />
          <TextField
            label={m.subjectDialog.teacher}
            hint={m.subjectDialog.teacherHint}
            optional
            value={teacher}
            onChange={(event) => setTeacher(event.target.value)}
            error={errors.teacher}
            maxLength={80}
            autoComplete="off"
          />
          <TextField
            label={m.subjectDialog.hours}
            optional
            type="number"
            inputMode="numeric"
            min={1}
            max={40}
            value={hours}
            onChange={(event) => setHours(event.target.value)}
            error={errors.hours}
            className="max-w-64"
          />
          <IconPicker legend={m.subjectDialog.icon} value={icon} onChange={setIcon} />
          {errors.form && <FieldError>{errors.form}</FieldError>}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            {subject && (
              <Button
                variant="danger"
                className="sm:mr-auto"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
              >
                {m.subjectDialog.delete}
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
      {confirmDelete && subject && (
        <ConfirmDialog
          title={format(m.confirm.deleteSubjectTitle, { name: subject.name })}
          description={m.confirm.deleteSubjectBody}
          confirmLabel={m.common.delete}
          busy={busy}
          onConfirm={() => void onDelete()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
