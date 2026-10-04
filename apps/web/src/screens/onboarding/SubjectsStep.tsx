import { X } from 'lucide-react';
import { type FormEvent, lazy, Suspense, useState } from 'react';
import { ApiError } from '../../api/client';
import { format, messages as m } from '../../i18n';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/Field';
import { FieldError } from '../../ui/FieldError';
import { Segmented } from '../../ui/Segmented';
import { SubjectIcon } from '../../ui/SubjectIcon';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { commonErrorMessage } from '../auth-errors';
import { StepFrame } from './StepFrame';

// Die Auswahl wird erst gebraucht, wenn man Fächer anlegt, und hält so das Hauptpaket klein.
const TemplatePicker = lazy(() =>
  import('../subjects/TemplatePicker').then((module) => ({ default: module.TemplatePicker })),
);

type Mode = 'template' | 'manual' | 'import';

const MAX_IMPORT_BYTES = 256 * 1024;

function importErrorMessage(error: unknown): string {
  const e = m.onboarding.subjects.errors;
  if (error instanceof ApiError) {
    if (error.code === 'payload_too_large') return e.fileTooLarge;
    if (error.code === 'invalid_input' && error.details.field === 'content') {
      if (error.details.reason === 'empty') return e.empty;
      if (error.details.reason === 'too_many') return e.tooMany;
      return e.invalidFormat;
    }
  }
  return commonErrorMessage(error);
}

function ManualTab({ initialName = '' }: { initialName?: string }) {
  const { addSubject } = useWorkspace();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === '') return setError(m.errors.invalidName);
    setBusy(true);
    setError(null);
    try {
      await addSubject({ name: name.trim() });
      setName('');
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'name_taken') {
        setError(m.onboarding.subjects.errors.nameTaken);
      } else if (caught instanceof ApiError && caught.code === 'name_reserved') {
        setError(m.subjectDialog.errors.nameReserved);
      } else if (caught instanceof ApiError && caught.code === 'invalid_input') {
        setError(m.errors.invalidName);
      } else {
        setError(commonErrorMessage(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="flex items-start gap-2">
        <TextField
          className="flex-1"
          label={m.onboarding.subjects.manualLabel}
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={error}
          maxLength={80}
          autoComplete="off"
        />
        <Button type="submit" variant="secondary" busy={busy} className="mt-[1.625rem]">
          {m.onboarding.subjects.manualSubmit}
        </Button>
      </div>
    </form>
  );
}

function ImportTab() {
  const { importSubjects } = useWorkspace();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const e = m.onboarding.subjects.errors;

  async function onFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setError(null);
    setResult(null);

    const extension = file.name.toLowerCase().split('.').pop();
    if (extension !== 'json' && extension !== 'csv') return setError(e.fileType);
    if (file.size > MAX_IMPORT_BYTES) return setError(e.fileTooLarge);

    setBusy(true);
    try {
      const summary = await importSubjects(extension, await file.text());
      setResult(
        format(m.onboarding.subjects.importResult, {
          created: summary.created,
          skipped: summary.skipped,
          invalid: summary.invalid,
        }),
      );
    } catch (caught) {
      setError(importErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-ink-secondary">{m.onboarding.subjects.importLead}</p>
      <input
        type="file"
        accept=".json,.csv,application/json,text/csv"
        aria-label={m.onboarding.subjects.importChoose}
        disabled={busy}
        onChange={(event) => void onFile(event.target)}
        className="mt-3 block w-full text-sm text-ink-secondary file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-control file:border file:border-control-edge file:bg-sheet file:px-4 file:font-medium file:text-ink hover:file:bg-paper"
      />
      {error && <FieldError>{error}</FieldError>}
      {result && (
        <p role="status" className="mt-3 text-sm text-ink-secondary">
          {result}
        </p>
      )}
    </div>
  );
}

export function SubjectsStep({
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
  const { subjects, removeSubject } = useWorkspace();
  const [mode, setMode] = useState<Mode>('template');
  // Das Gesuchte steht nicht im Katalog: von dort geht es mit dem Namen weiter zum eigenen Fach.
  const [customName, setCustomName] = useState('');
  const [removeError, setRemoveError] = useState<string | null>(null);
  const s = m.onboarding.subjects;

  async function remove(id: string) {
    setRemoveError(null);
    try {
      await removeSubject(id);
    } catch (caught) {
      setRemoveError(commonErrorMessage(caught));
    }
  }

  return (
    <StepFrame step={step} total={total} title={s.title} lead={s.lead}>
      <Segmented
        legend={s.tabs}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'template', label: s.template },
          { value: 'manual', label: s.manual },
          { value: 'import', label: s.import },
        ]}
      />
      <div className="mt-5">
        {mode === 'template' && (
          <>
            <p className="mb-3 text-sm text-ink-secondary">{s.templateLead}</p>
            <Suspense
              fallback={
                <p role="status" className="text-ink-muted">
                  {m.templatePicker.loading}
                </p>
              }
            >
              <TemplatePicker
                onCustom={(name) => {
                  setCustomName(name);
                  setMode('manual');
                }}
              />
            </Suspense>
          </>
        )}
        {mode === 'manual' && <ManualTab initialName={customName} />}
        {mode === 'import' && <ImportTab />}
      </div>

      <section className="mt-8 border-t border-line pt-5" aria-labelledby="created-heading">
        <h2 id="created-heading" className="text-meta font-medium text-ink-muted">
          {s.created}
        </h2>
        {subjects.length === 0 ? (
          <p className="mt-2 text-ink-muted">{s.createdNone}</p>
        ) : (
          <ul className="mt-1">
            {subjects.map((subject) => (
              <li key={subject.id} className="flex min-h-11 items-center gap-3">
                <SubjectIcon
                  icon={subject.icon}
                  className="size-[18px] shrink-0 text-ink-secondary"
                />
                <span className="min-w-0 flex-1 truncate">{subject.name}</span>
                <button
                  type="button"
                  onClick={() => void remove(subject.id)}
                  aria-label={format(s.remove, { name: subject.name })}
                  className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-paper hover:text-ink"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {removeError && <FieldError>{removeError}</FieldError>}
      </section>

      <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onBack}>
          {m.common.back}
        </Button>
        <Button variant="primary" onClick={onNext}>
          {m.common.next}
        </Button>
      </div>
    </StepFrame>
  );
}
