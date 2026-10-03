import { X } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import { format, messages as m } from '../../i18n';
import { useSession } from '../../session/SessionProvider';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/Field';
import { FieldError } from '../../ui/FieldError';
import { Segmented } from '../../ui/Segmented';
import { SubjectIcon } from '../../ui/SubjectIcon';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { commonErrorMessage } from '../auth-errors';
import { StepFrame } from './StepFrame';

type Mode = 'template' | 'manual' | 'import';

const MAX_IMPORT_BYTES = 256 * 1024;
const lower = (name: string) => name.trim().toLocaleLowerCase('de');

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

function TemplateTab() {
  const { api } = useSession();
  const { subjects, importSubjects } = useWorkspace();
  const [templates, setTemplates] = useState<{ name: string }[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .subjectTemplates()
      .then((reply) => {
        if (!cancelled) setTemplates(reply.subjects);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setTemplates([]);
        setError(commonErrorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const existing = new Set(subjects.map((subject) => lower(subject.name)));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const entries = [...chosen].map((name) => ({ name }));
      await importSubjects('json', JSON.stringify({ version: 1, subjects: entries }));
      setChosen(new Set());
    } catch (caught) {
      setError(importErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (templates === null) return null;
  return (
    <div>
      <p className="text-sm text-ink-secondary">{m.onboarding.subjects.templateLead}</p>
      {templates.length === 0 ? (
        <p className="mt-3 text-ink-muted">{m.onboarding.subjects.templateNone}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {templates.map((template) => {
            const taken = existing.has(lower(template.name));
            const id = `template-${template.name}`;
            return (
              <li key={template.name}>
                <label
                  htmlFor={id}
                  className="flex min-h-12 cursor-pointer items-center gap-3 py-2 has-[:disabled]:cursor-default has-[:disabled]:text-ink-muted"
                >
                  <input
                    id={id}
                    type="checkbox"
                    className="size-5 accent-primary"
                    disabled={taken}
                    checked={taken || chosen.has(template.name)}
                    onChange={(event) =>
                      setChosen((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(template.name);
                        else next.delete(template.name);
                        return next;
                      })
                    }
                  />
                  <span className="flex-1">{template.name}</span>
                  {taken && (
                    <span className="text-meta text-ink-muted">
                      {m.onboarding.subjects.templateExists}
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {error && <FieldError>{error}</FieldError>}
      <Button
        variant="secondary"
        className="mt-4"
        busy={busy}
        disabled={chosen.size === 0}
        onClick={() => void submit()}
      >
        {m.onboarding.subjects.templateSubmit}
      </Button>
    </div>
  );
}

function ManualTab() {
  const { addSubject } = useWorkspace();
  const [name, setName] = useState('');
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
        className="mt-3 block w-full text-sm text-ink-secondary file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-control file:border file:border-control-edge file:bg-canvas file:px-4 file:font-medium file:text-ink hover:file:bg-paper"
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
        {mode === 'template' && <TemplateTab />}
        {mode === 'manual' && <ManualTab />}
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
