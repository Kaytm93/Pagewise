import { type ChangeEvent, useEffect, useId, useRef, useState } from 'react';
import { ApiError, isAbort } from '../api/client';
import type {
  ScanImportEntry,
  ScanModel,
  ScanPeriodTime,
  ScanProposalView,
  WeekKind,
} from '../api/types';
import { format, messages as m } from '../i18n';
import { commonErrorMessage } from '../screens/auth-errors';
import { useSession } from '../session/SessionProvider';
import { Button } from '../ui/Button';
import { CheckField, SelectField } from '../ui/Field';
import { FieldError } from '../ui/FieldError';
import { Modal, ModalFooter } from '../ui/modal';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { usePlanner } from './PlannerProvider';
import { AbbreviationsEditor, ScheduleEditor } from './ScanSettings';
import { MAX_CLIENT_IMAGE_BYTES, MAX_SCAN_IMAGE_BYTES, prepareImage } from './scan-image';
import { retime } from './scan-schedule';

type Phase = 'select' | 'scanning' | 'preview' | 'importing';

interface EditableProposal extends ScanProposalView {
  /** Stabile Kennung für die Liste; der Server liefert für Vorschläge keine ID. */
  id: string;
  include: boolean;
}

let sequence = 0;
function nextId(): string {
  sequence += 1;
  return `vorschlag-${sequence}`;
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];
const cell =
  'min-h-10 w-full rounded-control border border-control-edge bg-sheet px-2 text-sm text-ink disabled:opacity-60';

function errorMessage(error: unknown): string {
  const e = m.planning.timetableScan.errors;
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'network':
        return commonErrorMessage(error);
      case 'images_not_allowed':
        return e.imagesNotAllowed;
      case 'no_vision_model':
        return e.noVisionModel;
      case 'provider_failed':
        return e.providerFailed;
      case 'invalid_response':
        return e.invalidResponse;
      case 'too_many':
        return e.tooMany;
      case 'invalid_input':
        return error.details.reason === 'before_start' ? e.times : e.unknown;
      case 'aborted':
        return e.aborted;
    }
  }
  return e.unknown;
}

/**
 * Stundenplan aus einem Bild (D-107): Modell wählen, Bild abgeben, Vorschläge prüfen und erst dann
 * übernehmen. Erkennen und Übernehmen sind getrennt — die Vorschau verändert keine Daten. Abbrechen
 * beendet auch die Anfrage an das Modell.
 */
export function TimetableScanDialog({ onClose }: { onClose: () => void }) {
  const { api } = useSession();
  const { reload } = usePlanner();
  const { refreshSubjects } = useWorkspace();
  const t = m.planning.timetableScan;
  const fileId = useId();
  const [attempt, setAttempt] = useState(0);
  const [models, setModels] = useState<ScanModel[] | null>(null);
  const [modelsFailed, setModelsFailed] = useState(false);
  const [selected, setSelected] = useState('');
  const [image, setImage] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('select');
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<EditableProposal[]>([]);
  const [newSubjects, setNewSubjects] = useState<string[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [createSubjects, setCreateSubjects] = useState(true);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [retimed, setRetimed] = useState(false);
  const controller = useRef<AbortController | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` löst das erneute Laden aus
  useEffect(() => {
    let cancelled = false;
    setModelsFailed(false);
    api
      .timetableScanModels()
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        setSelected(list.length === 1 ? '0' : '');
      })
      .catch(() => {
        if (!cancelled) setModelsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, attempt]);

  useEffect(
    () => () => {
      if (previewUrl && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [previewUrl],
  );

  // Wird der Dialog geschlossen, soll auch die Anfrage an den Anbieter enden.
  useEffect(() => () => controller.current?.abort(), []);

  const choice = models?.[Number(selected)];
  const included = proposals.filter((entry) => entry.include);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setImage(null);
    setPreviewUrl(null);
    setFileError(null);
    setError(null);
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      setFileError(t.errors.fileType);
      return;
    }
    if (file.size > MAX_CLIENT_IMAGE_BYTES) {
      setFileError(t.errors.fileSize);
      return;
    }
    try {
      const prepared = await prepareImage(file);
      if (prepared.size > MAX_SCAN_IMAGE_BYTES) {
        setFileError(t.errors.fileSize);
        return;
      }
      setImage(prepared);
      if (typeof URL.createObjectURL === 'function') setPreviewUrl(URL.createObjectURL(prepared));
    } catch {
      setFileError(t.errors.fileRead);
    }
  }

  async function startScan() {
    if (!choice) {
      setError(t.errors.noModel);
      return;
    }
    if (!image) {
      setError(t.errors.noImage);
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setPhase('scanning');
    setError(null);
    try {
      const reply = await api.scanTimetable(image, choice.providerId, choice.model, abort.signal);
      setProposals(reply.proposals.map((entry) => ({ ...entry, id: nextId(), include: true })));
      setNewSubjects(reply.newSubjects);
      setSkipped(reply.skipped);
      setReplaceExisting(false);
      setRetimed(false);
      setPhase('preview');
    } catch (caught) {
      if (!isAbort(caught)) setError(errorMessage(caught));
      setPhase('select');
    } finally {
      controller.current = null;
    }
  }

  function update(index: number, patch: Partial<EditableProposal>) {
    setProposals((current) =>
      current.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)),
    );
  }

  /** Neue Stundentafel: Stunden mit Nummer bekommen in der Vorschau sofort die neuen Zeiten. */
  function applyPeriods(periods: ScanPeriodTime[]) {
    if (!proposals.some((entry) => entry.period !== null)) return;
    setProposals((current) => retime(current, periods));
    setRetimed(true);
  }

  async function takeOver() {
    if (included.length === 0) return;
    if (included.some((entry) => entry.endTime <= entry.startTime)) {
      setError(t.errors.times);
      return;
    }
    const entries: ScanImportEntry[] = included.map((entry) => ({
      weekday: entry.weekday,
      startTime: entry.startTime,
      endTime: entry.endTime,
      code: entry.code,
      subject: entry.subject?.trim() || null,
      room: entry.room,
      note: entry.note,
      week: entry.week,
    }));
    setPhase('importing');
    setError(null);
    try {
      await api.importTimetableScan({ entries, createSubjects, replaceExisting });
      await Promise.all([reload(), refreshSubjects()]);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
      setPhase('preview');
    }
  }

  return (
    <Modal title={t.title} description={t.description} onClose={onClose} wide>
      {phase === 'select' && (
        <div className="space-y-4">
          {models === null && !modelsFailed && (
            <p role="status" className="text-sm text-ink-muted">
              {t.modelsLoading}
            </p>
          )}
          {modelsFailed && (
            <div>
              <p role="alert" className="text-sm text-danger">
                {t.modelsFailed}
              </p>
              <Button
                variant="secondary"
                className="mt-2"
                onClick={() => {
                  setModels(null);
                  setAttempt((value) => value + 1);
                }}
              >
                {m.common.retry}
              </Button>
            </div>
          )}
          {models?.length === 0 && (
            <p role="status" className="rounded-box bg-paper p-3 text-sm text-ink-secondary">
              {t.noModels}
            </p>
          )}
          {models && models.length > 0 && (
            <>
              <SelectField
                label={t.model}
                hint={t.modelHint}
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">{t.chooseModel}</option>
                {models.map((entry, index) => (
                  <option key={`${entry.providerId}-${entry.model}`} value={String(index)}>
                    {entry.label}
                  </option>
                ))}
              </SelectField>
              {choice?.free && (
                <p role="status" className="text-sm text-ink-secondary">
                  {t.freeHint}
                </p>
              )}
            </>
          )}
          <div>
            <label htmlFor={fileId} className="block text-sm font-medium text-ink">
              {t.image}
            </label>
            <input
              id={fileId}
              type="file"
              accept="image/png,image/jpeg"
              onChange={(event) => void chooseFile(event)}
              data-autofocus
              className="mt-1.5 block w-full text-sm text-ink file:mr-3 file:rounded-control file:border file:border-control-edge file:bg-sheet file:px-3 file:py-2"
            />
            <p className="mt-1.5 text-sm text-ink-muted">{t.imageHint}</p>
            {fileError && <FieldError>{fileError}</FieldError>}
          </div>
          <ScheduleEditor onSaved={applyPeriods} />
          <AbbreviationsEditor />
          {previewUrl && (
            <img
              src={previewUrl}
              alt={t.preview}
              className="max-h-48 w-auto rounded-box border border-line-warm"
            />
          )}
          <p className="text-sm text-ink-secondary">{t.privacy}</p>
        </div>
      )}

      {phase === 'scanning' && (
        <p role="status" className="text-sm text-ink-secondary">
          {t.scanning}
        </p>
      )}

      {phase === 'preview' && (
        <div className="space-y-3">
          {proposals.length === 0 ? (
            <div className="rounded-box bg-paper p-4">
              <p className="font-medium">{t.emptyTitle}</p>
              <p className="mt-1 text-sm text-ink-secondary">{t.emptyHint}</p>
            </div>
          ) : (
            <>
              <p className="font-medium">{format(t.previewTitle, { count: proposals.length })}</p>
              <p className="text-sm text-ink-secondary">{t.previewHint}</p>
              <p className="text-sm text-ink-secondary">{t.emptyCells}</p>
              {proposals.some((entry) => entry.period !== null) && (
                <>
                  <p role="status" className="text-sm text-ink-secondary">
                    {retimed ? t.scheduleRetimed : t.periodsMapped}
                  </p>
                  <ScheduleEditor onSaved={applyPeriods} />
                </>
              )}
              {newSubjects.length > 0 && (
                <p role="status" className="text-sm text-ink-secondary">
                  {format(t.newSubjects, { names: newSubjects.join(', ') })}
                </p>
              )}
              {skipped > 0 && (
                <p className="text-sm text-ink-muted">{format(t.skipped, { count: skipped })}</p>
              )}
              <ul className="space-y-2">
                {proposals.map((entry, index) => (
                  <li key={entry.id} className="rounded-box border border-line-warm bg-paper p-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={entry.include}
                        onChange={(event) => update(index, { include: event.target.checked })}
                        aria-label={`${t.include} ${index + 1}`}
                        className="mt-2 size-5 shrink-0 accent-primary"
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <select
                            aria-label={`${t.weekday} ${index + 1}`}
                            value={entry.weekday}
                            disabled={!entry.include}
                            onChange={(event) =>
                              update(index, { weekday: Number(event.target.value) })
                            }
                            className={cell}
                          >
                            {m.planning.days.map((day, at) => (
                              <option key={day} value={at + 1}>
                                {day}
                              </option>
                            ))}
                          </select>
                          <input
                            type="time"
                            aria-label={`${t.from} ${index + 1}`}
                            value={entry.startTime}
                            disabled={!entry.include}
                            onChange={(event) => update(index, { startTime: event.target.value })}
                            className={cell}
                          />
                          <input
                            type="time"
                            aria-label={`${t.to} ${index + 1}`}
                            value={entry.endTime}
                            disabled={!entry.include}
                            onChange={(event) => update(index, { endTime: event.target.value })}
                            className={cell}
                          />
                          <select
                            aria-label={`${t.week} ${index + 1}`}
                            value={entry.week}
                            disabled={!entry.include}
                            onChange={(event) =>
                              update(index, { week: event.target.value as WeekKind })
                            }
                            className={cell}
                          >
                            <option value="all">{t.weekAll}</option>
                            <option value="a">{t.weekA}</option>
                            <option value="b">{t.weekB}</option>
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            aria-label={`${t.subject} ${index + 1}`}
                            value={entry.subject ?? ''}
                            disabled={!entry.include}
                            maxLength={80}
                            onChange={(event) => update(index, { subject: event.target.value })}
                            className={cell}
                          />
                          <input
                            type="text"
                            aria-label={`${t.room} ${index + 1}`}
                            value={entry.room ?? ''}
                            disabled={!entry.include}
                            maxLength={40}
                            onChange={(event) => update(index, { room: event.target.value })}
                            className={cell}
                          />
                        </div>
                        <p className="text-meta text-ink-muted">
                          {t.subjectState[entry.subjectState]}
                          {entry.period !== null
                            ? ` · ${
                                entry.periodEnd !== null
                                  ? format(t.periodDouble, {
                                      period: entry.period,
                                      end: entry.periodEnd,
                                    })
                                  : format(t.periodLabel, { period: entry.period })
                              }`
                            : ''}
                          {entry.code ? ` · ${format(t.codeLabel, { code: entry.code })}` : ''}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <CheckField
                label={t.createSubjects}
                hint={t.createSubjectsHint}
                checked={createSubjects}
                onChange={setCreateSubjects}
              />
              <CheckField
                label={t.replaceExisting}
                hint={t.replaceExistingHint}
                checked={replaceExisting}
                onChange={setReplaceExisting}
              />
            </>
          )}
        </div>
      )}

      {error && <FieldError>{error}</FieldError>}

      <ModalFooter>
        {(phase === 'preview' || phase === 'scanning') && (
          <Button
            variant="secondary"
            className="sm:mr-auto"
            onClick={() => {
              if (phase === 'scanning') controller.current?.abort();
              else setPhase('select');
            }}
          >
            {phase === 'scanning' ? t.cancel : t.back}
          </Button>
        )}
        <Button variant="secondary" onClick={onClose} disabled={phase === 'importing'}>
          {t.close}
        </Button>
        {phase === 'select' && (
          <Button
            variant="primary"
            onClick={() => void startScan()}
            disabled={!models || models.length === 0 || !choice || !image}
          >
            {t.scan}
          </Button>
        )}
        {phase === 'scanning' && (
          <Button variant="primary" busy>
            {t.scanning}
          </Button>
        )}
        {phase === 'preview' && proposals.length > 0 && (
          <Button
            variant="primary"
            onClick={() => void takeOver()}
            disabled={included.length === 0}
          >
            {format(t.import, { count: included.length })}
          </Button>
        )}
        {phase === 'importing' && (
          <Button variant="primary" busy>
            {t.importing}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
