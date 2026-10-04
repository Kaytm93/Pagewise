import { type FormEvent, useId, useState } from 'react';
import { ApiError } from '../api/client';
import type { Exam } from '../api/types';
import { format, messages as m } from '../i18n';
import { commonErrorMessage } from '../screens/auth-errors';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { SelectField, TextAreaField, TextField } from '../ui/Field';
import { FieldError } from '../ui/FieldError';
import { Modal } from '../ui/modal';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { isValidDate, localDate, TIME_PATTERN } from './dates';
import { usePlanner } from './PlannerProvider';

type Errors = { subject?: string; kind?: string; date?: string; time?: string; form?: string };

function mapError(error: unknown): Errors {
  const e = m.planning.examDialog.errors;
  if (error instanceof ApiError) {
    if (error.code === 'too_many') return { form: e.tooMany };
    if (error.code === 'not_found') return { form: e.notFound };
    if (error.code === 'invalid_input') {
      const { field } = error.details;
      if (field === 'subjectId') return { subject: e.subject };
      if (field === 'kind') return { kind: e.kind };
      if (field === 'date') return { date: e.date };
      if (field === 'time') return { time: e.time };
    }
  }
  return { form: commonErrorMessage(error) };
}

/** Einen Test eintragen (ohne `exam`) oder bearbeiten, samt Löschen mit Rückfrage. */
export function ExamDialog({
  exam,
  subjectId: presetSubject,
  onClose,
}: {
  exam?: Exam;
  /** Vorgewähltes Fach beim Eintragen (zum Beispiel von der Seite des Fachs). */
  subjectId?: string;
  onClose: () => void;
}) {
  const { subjects } = useWorkspace();
  const { addExam, editExam, removeExam } = usePlanner();
  const d = m.planning.examDialog;
  const [subjectId, setSubjectId] = useState(
    exam?.subjectId ?? presetSubject ?? subjects[0]?.id ?? '',
  );
  const [kind, setKind] = useState(exam?.kind ?? '');
  const [title, setTitle] = useState(exam?.title ?? '');
  const [date, setDate] = useState(exam?.date ?? localDate());
  const [time, setTime] = useState(exam?.time ?? '');
  const [topics, setTopics] = useState(exam?.topics ?? '');
  const [notes, setNotes] = useState(exam?.notes ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const listId = useId();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next: Errors = {};
    if (!subjectId) next.subject = d.errors.subject;
    const trimmedKind = kind.trim();
    if (trimmedKind === '' || [...trimmedKind].length > 40) next.kind = d.errors.kind;
    if (!isValidDate(date)) next.date = d.errors.date;
    if (time !== '' && !TIME_PATTERN.test(time)) next.time = d.errors.time;
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      const input = {
        subjectId,
        kind: trimmedKind,
        title: title.trim() || null,
        date,
        time: time || null,
        topics: topics.trim() || null,
        notes: notes.trim() || null,
      };
      if (exam) await editExam(exam.id, input);
      else await addExam(input);
      onClose();
    } catch (caught) {
      setErrors(mapError(caught));
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!exam) return;
    setBusy(true);
    try {
      await removeExam(exam.id);
      onClose();
    } catch (caught) {
      setConfirmDelete(false);
      setErrors(mapError(caught));
      setBusy(false);
    }
  }

  const heading = exam ? d.editTitle : d.createTitle;
  return (
    <>
      <Modal title={heading} onClose={onClose}>
        {subjects.length === 0 ? (
          <p className="text-ink-secondary">{m.planning.exams.noSubjects}</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <SelectField
              label={d.subject}
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
              error={errors.subject}
              data-autofocus
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </SelectField>
            <TextField
              label={d.kind}
              hint={d.kindHint}
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              error={errors.kind}
              maxLength={40}
              autoComplete="off"
              list={listId}
            />
            <datalist id={listId}>
              {d.kinds.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <TextField
              label={d.title}
              optional
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              autoComplete="off"
            />
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label={d.date}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                error={errors.date}
                required
              />
              <TextField
                label={d.time}
                optional
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                error={errors.time}
              />
            </div>
            <TextAreaField
              compact
              label={d.topics}
              value={topics}
              onChange={(event) => setTopics(event.target.value)}
              maxLength={2000}
            />
            <TextAreaField
              compact
              label={d.notes}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
            />
            {errors.form && <FieldError>{errors.form}</FieldError>}
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              {exam && (
                <Button
                  variant="danger"
                  className="sm:mr-auto"
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy}
                >
                  {d.delete}
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
        )}
      </Modal>
      {confirmDelete && exam && (
        <ConfirmDialog
          title={format(d.confirmDelete.title, { name: exam.title ?? exam.kind })}
          description={d.confirmDelete.body}
          confirmLabel={m.common.delete}
          busy={busy}
          onConfirm={() => void onDelete()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
