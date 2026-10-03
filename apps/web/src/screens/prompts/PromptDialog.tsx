import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import type { PromptPreview, PromptScope, PromptState } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { useSession } from '../../session/SessionProvider';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { TextAreaField } from '../../ui/Field';
import { FieldError } from '../../ui/FieldError';
import { Modal } from '../../ui/modal';
import { Segmented } from '../../ui/Segmented';
import { commonErrorMessage } from '../auth-errors';

export const PROMPT_MAX = 20_000;

export type PromptLayerName = 'general' | 'subject' | 'group';

export interface PreviewTarget {
  subjectId: string;
  groupId: string | null;
}

function saveError(error: unknown): string {
  const e = m.prompts.errors;
  if (error instanceof ApiError) {
    if (error.code === 'not_found') return e.notFound;
    if (error.code === 'payload_too_large') return format(e.tooLong, { max: PROMPT_MAX });
    if (error.code === 'invalid_input') return e.invalid;
  }
  return commonErrorMessage(error);
}

function Preview({ target }: { target: PreviewTarget }) {
  const { api } = useSession();
  const [preview, setPreview] = useState<PromptPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .promptPreview(target.subjectId, target.groupId)
      .then((reply) => {
        if (!cancelled) setPreview(reply);
      })
      .catch(() => {
        if (!cancelled) setError(m.prompts.errors.preview);
      });
    return () => {
      cancelled = true;
    };
  }, [api, target.subjectId, target.groupId]);

  if (error) return <FieldError>{error}</FieldError>;
  if (!preview) return <p className="text-ink-muted">{m.prompts.previewLoading}</p>;

  const only0 = preview.layers.length === 1;
  return (
    <div>
      <p className="text-sm text-ink-secondary">{m.prompts.previewLead}</p>
      {preview.missing.length > 0 && (
        <p role="note" className="mt-3 rounded-box bg-paper p-3 text-sm text-ink-secondary">
          {format(m.prompts.previewMissing, {
            names: preview.missing.map((name) => `{{${name}}}`).join(', '),
          })}
        </p>
      )}
      <div className="mt-4 divide-y divide-line border-y border-line">
        {preview.layers.map((layer) => (
          <section key={layer.layer} className="py-3">
            <h3 className="text-meta font-medium text-ink-muted">
              {m.prompts.previewLayers[layer.layer]}
              {layer.origin === 'default' && ` (${m.prompts.originDefault})`}
            </h3>
            <p className="mt-1 text-sm whitespace-pre-wrap break-words">{layer.text}</p>
          </section>
        ))}
      </div>
      {only0 && <p className="mt-3 text-sm text-ink-muted">{m.prompts.previewOnlyTechnical}</p>}
    </div>
  );
}

/**
 * Prompt einer Ebene bearbeiten. Mit `preview` zeigt ein zweiter Reiter, wie das Modell den
 * zusammengesetzten System-Prompt sieht (gespeicherter Stand).
 *
 * Der Fach-Prompt hat einen mitgelieferten Standardtext (D-034, `initial.defaultText`). Solange der Nutzer
 * nichts eigenes einträgt, gilt er: Der Dialog zeigt ihn lesbar, „Bearbeiten“ kopiert ihn ins Eingabefeld,
 * und „Auf Standard zurücksetzen“ verwirft den eigenen Text wieder.
 */
export function PromptDialog({
  scope,
  layer,
  initial,
  preview,
  onSaved,
  onClose,
}: {
  scope: PromptScope;
  layer: PromptLayerName;
  initial: PromptState;
  preview?: PreviewTarget;
  onSaved: (state: PromptState) => void;
  onClose: () => void;
}) {
  const { api } = useSession();
  const [state, setState] = useState<PromptState>(initial);
  const defaultText = state.defaultText;
  // Gilt der Standard, zeigt der Dialog ihn zunächst nur an; erst „Bearbeiten“ öffnet das Eingabefeld.
  const [editing, setEditing] = useState(initial.source !== 'default');
  const effective = state.text ?? defaultText ?? '';
  const [text, setText] = useState(effective);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const dirty = text !== effective;
  const tooLong = [...text].length > PROMPT_MAX;
  const hasDefault = defaultText !== null;
  const customActive = state.text !== null;

  function adopt(next: PromptState) {
    setState(next);
    setText(next.text ?? next.defaultText ?? '');
    setEditing(next.source !== 'default');
    setVersion((value) => value + 1);
    onSaved(next);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Ein unverändert übernommener Standardtext bleibt „Standard“ und wird nicht als eigener Text kopiert:
      // So bekommt man spätere Verbesserungen des Standards weiterhin automatisch.
      const keepDefault = hasDefault && text === defaultText;
      adopt(await api.savePrompt(scope, keepDefault || text.trim() === '' ? null : text));
      setJustSaved(true);
    } catch (caught) {
      setError(saveError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function resetToDefault() {
    setBusy(true);
    setError(null);
    try {
      adopt(await api.savePrompt(scope, null));
      setJustSaved(true);
    } catch (caught) {
      setError(saveError(caught));
    } finally {
      setBusy(false);
      setConfirmReset(false);
    }
  }

  const showEditor = tab === 'edit' || !preview;
  return (
    <>
      <Modal
        wide
        title={m.prompts.layers[layer]}
        description={m.prompts.layerLead[layer]}
        onClose={onClose}
      >
        {preview && (
          <div className="mb-4">
            <Segmented
              legend={m.prompts.tabs}
              value={tab}
              onChange={setTab}
              options={[
                { value: 'edit', label: m.prompts.tabEdit },
                { value: 'preview', label: m.prompts.tabPreview },
              ]}
            />
          </div>
        )}

        {showEditor && hasDefault && (
          <div role="note" className="mb-4 rounded-box bg-paper p-3 text-sm text-ink-secondary">
            <p className="font-medium text-ink">
              {customActive ? m.prompts.sourceCustom : m.prompts.sourceDefault}
            </p>
            <p className="mt-1">{m.prompts.defaultNote}</p>
          </div>
        )}

        {showEditor ? (
          editing ? (
            <div>
              <TextAreaField
                label={m.prompts.editorLabel}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setJustSaved(false);
                }}
                error={tooLong ? format(m.prompts.errors.tooLong, { max: PROMPT_MAX }) : null}
                spellCheck
                data-autofocus
              />
              <div className="mt-1.5 flex items-center justify-between gap-4 text-meta text-ink-muted">
                <span>
                  {format(m.prompts.counter, { count: [...text].length, max: PROMPT_MAX })}
                </span>
                {dirty && <span>{m.prompts.dirtyHint}</span>}
              </div>
              <details className="mt-4">
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
                  {m.prompts.variablesTitle}
                </summary>
                <p className="text-sm text-ink-secondary">{m.prompts.variablesLead}</p>
                <dl className="mt-2 space-y-1 text-sm">
                  {(Object.keys(m.prompts.variables) as (keyof typeof m.prompts.variables)[]).map(
                    (name) => (
                      <div key={name} className="flex flex-wrap gap-x-3">
                        <dt className="font-mono text-ink">{`{{${name}}}`}</dt>
                        <dd className="text-ink-secondary">{m.prompts.variables[name]}</dd>
                      </div>
                    ),
                  )}
                </dl>
              </details>
            </div>
          ) : (
            <div>
              <p className="text-meta font-medium text-ink-muted">{m.prompts.defaultTextLabel}</p>
              <p className="mt-1 rounded-box border border-line p-3 text-sm whitespace-pre-wrap break-words">
                {defaultText}
              </p>
            </div>
          )
        ) : (
          <Preview key={version} target={preview as PreviewTarget} />
        )}

        {error && <FieldError>{error}</FieldError>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {showEditor && !hasDefault && (
            <Button
              variant="ghost"
              className="sm:mr-auto"
              disabled={busy || text === ''}
              onClick={() => {
                setText('');
                setJustSaved(false);
              }}
            >
              {m.prompts.clear}
            </Button>
          )}
          {showEditor && hasDefault && customActive && (
            <Button
              variant="ghost"
              className="sm:mr-auto"
              disabled={busy}
              onClick={() => setConfirmReset(true)}
            >
              {m.prompts.resetToDefault}
            </Button>
          )}
          {justSaved && !dirty && (
            <p role="status" className="text-sm text-ink-secondary">
              {m.prompts.saved}
            </p>
          )}
          <Button variant="secondary" onClick={onClose}>
            {m.common.close}
          </Button>
          {showEditor && !editing && (
            <Button
              variant="primary"
              onClick={() => {
                setText(effective);
                setEditing(true);
              }}
            >
              {m.prompts.edit}
            </Button>
          )}
          {showEditor && editing && (
            <Button
              variant="primary"
              busy={busy}
              disabled={tooLong || !dirty}
              onClick={() => void save()}
            >
              {m.common.save}
            </Button>
          )}
        </div>
      </Modal>
      {confirmReset && (
        <ConfirmDialog
          title={m.prompts.resetTitle}
          description={m.prompts.resetBody}
          confirmLabel={m.prompts.resetConfirm}
          busy={busy}
          onConfirm={() => void resetToDefault()}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </>
  );
}
