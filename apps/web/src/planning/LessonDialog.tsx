import { type FormEvent, useId, useState } from 'react';
import { ApiError } from '../api/client';
import type { TimetableEntry, WeekKind } from '../api/types';
import { format, messages as m } from '../i18n';
import { commonErrorMessage } from '../screens/auth-errors';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { SelectField, TextField } from '../ui/Field';
import { FieldError } from '../ui/FieldError';
import { Modal } from '../ui/modal';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { TIME_PATTERN } from './dates';
import { usePlanner } from './PlannerProvider';
import { overlapping } from './schedule';

type Errors = { start?: string; end?: string; form?: string };

function mapError(error: unknown): Errors {
  const e = m.planning.lessonDialog.errors;
  if (error instanceof ApiError) {
    if (error.code === 'too_many') return { form: e.tooMany };
    if (error.code === 'not_found') return { form: e.notFound };
    if (error.code === 'invalid_input') {
      const { field, reason } = error.details;
      if (field === 'endTime' && reason === 'before_start') return { end: e.end };
      if (field === 'startTime') return { start: e.time };
      if (field === 'endTime') return { end: e.time };
      if (field === 'subjectId') return { form: e.subject };
    }
  }
  return { form: commonErrorMessage(error) };
}

/** Eine Stunde im Stundenplan anlegen (ohne `entry`) oder bearbeiten, samt Löschen mit Rückfrage. */
export function LessonDialog({
  entry,
  weekday,
  onClose,
}: {
  entry?: TimetableEntry;
  /** Vorgewählter Wochentag beim Anlegen (1 = Montag). */
  weekday?: number;
  onClose: () => void;
}) {
  const { subjects } = useWorkspace();
  const { entries, addLesson, editLesson, removeLesson } = usePlanner();
  const d = m.planning.lessonDialog;
  const [day, setDay] = useState(String(entry?.weekday ?? weekday ?? 1));
  const [start, setStart] = useState(entry?.startTime ?? '08:00');
  const [end, setEnd] = useState(entry?.endTime ?? '08:45');
  const [subjectId, setSubjectId] = useState(entry?.subjectId ?? '');
  const [room, setRoom] = useState(entry?.room ?? '');
  const [note, setNote] = useState(entry?.note ?? '');
  const [week, setWeek] = useState<WeekKind>(entry?.week ?? 'all');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const warningId = useId();

  const draft: TimetableEntry = {
    id: entry?.id ?? 'neu',
    weekday: Number(day),
    startTime: start,
    endTime: end,
    subjectId: subjectId || null,
    room: null,
    note: null,
    week,
  };
  const valid = TIME_PATTERN.test(start) && TIME_PATTERN.test(end) && end > start;
  const clashes = valid ? overlapping(draft, entries) : [];
  const nameOf = (lesson: TimetableEntry) =>
    subjects.find((subject) => subject.id === lesson.subjectId)?.name ??
    m.planning.timetable.noSubject;
  const clashNames = clashes
    .map((lesson) => `${nameOf(lesson)} (${lesson.startTime}–${lesson.endTime})`)
    .join(', ');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next: Errors = {};
    if (!TIME_PATTERN.test(start)) next.start = d.errors.time;
    if (!TIME_PATTERN.test(end)) next.end = d.errors.time;
    else if (!next.start && end <= start) next.end = d.errors.end;
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      const input = {
        weekday: Number(day),
        startTime: start,
        endTime: end,
        subjectId: subjectId || null,
        room: room.trim() || null,
        note: note.trim() || null,
        week,
      };
      if (entry) await editLesson(entry.id, input);
      else await addLesson(input);
      onClose();
    } catch (caught) {
      setErrors(mapError(caught));
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!entry) return;
    setBusy(true);
    try {
      await removeLesson(entry.id);
      onClose();
    } catch (caught) {
      setConfirmDelete(false);
      setErrors(mapError(caught));
      setBusy(false);
    }
  }

  return (
    <>
      <Modal title={entry ? d.editTitle : d.createTitle} onClose={onClose}>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <SelectField
            label={d.weekday}
            value={day}
            onChange={(event) => setDay(event.target.value)}
            data-autofocus
          >
            {m.planning.days.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </SelectField>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label={d.from}
              type="time"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              error={errors.start}
              required
            />
            <TextField
              label={d.to}
              type="time"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              error={errors.end}
              required
            />
          </div>
          {clashes.length > 0 && (
            <p id={warningId} role="status" className="text-sm text-ink-secondary">
              {format(d.overlapWarning, { names: clashNames })}
            </p>
          )}
          <SelectField
            label={d.subject}
            value={subjectId}
            onChange={(event) => setSubjectId(event.target.value)}
          >
            <option value="">{d.noSubject}</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </SelectField>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label={d.room}
              optional
              value={room}
              onChange={(event) => setRoom(event.target.value)}
              maxLength={40}
              autoComplete="off"
            />
            <SelectField
              label={d.week}
              value={week}
              onChange={(event) => setWeek(event.target.value as WeekKind)}
            >
              <option value="all">{d.weekAll}</option>
              <option value="a">{d.weekA}</option>
              <option value="b">{d.weekB}</option>
            </SelectField>
          </div>
          <TextField
            label={d.note}
            optional
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={200}
            autoComplete="off"
          />
          {errors.form && <FieldError>{errors.form}</FieldError>}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            {entry && (
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
      </Modal>
      {confirmDelete && entry && (
        <ConfirmDialog
          title={d.confirmDelete.title}
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
