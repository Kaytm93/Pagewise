import { lazy, Suspense, useEffect, useState } from 'react';
import type { PromptScope, PromptState } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { useSession } from '../../session/SessionProvider';
import { Button } from '../../ui/Button';
import { FieldError } from '../../ui/FieldError';
import type { PreviewTarget, PromptLayerName } from './PromptDialog';

// Der Dialog wird erst beim Öffnen geladen und hält das Hauptpaket klein.
const PromptDialog = lazy(() =>
  import('./PromptDialog').then((module) => ({ default: module.PromptDialog })),
);

/** Eine Prompt-Ebene mit Stand („Noch nichts festgelegt“ oder Länge) und Knopf zum Bearbeiten. */
export function PromptRow({
  scope,
  layer,
  preview,
}: {
  scope: PromptScope;
  layer: PromptLayerName;
  preview?: PreviewTarget;
}) {
  const { api } = useSession();
  const [state, setState] = useState<PromptState | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const scopeKey = scope.type === 'general' ? 'general' : `${scope.type}:${scope.id}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `scopeKey` bildet `scope` vollständig ab
  useEffect(() => {
    let cancelled = false;
    setState(undefined);
    setFailed(false);
    api
      .prompt(scope)
      .then((value) => {
        if (!cancelled) setState(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, scopeKey]);

  let status: string = m.prompts.statusLoading;
  let action: string = m.prompts.define;
  if (state !== undefined) {
    if (state.source === 'default') {
      // Der mitgelieferte Standardtext gilt (D-034): ansehen, bei Bedarf ändern.
      status = m.prompts.statusDefault;
      action = m.prompts.viewDefault;
    } else if (state.text !== null) {
      status =
        state.defaultText !== null
          ? format(m.prompts.statusCustom, { count: [...state.text].length })
          : format(m.prompts.statusSet, { count: [...state.text].length });
      action = m.prompts.edit;
    } else {
      status = m.prompts.statusEmpty;
    }
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="font-medium">{m.prompts.layers[layer]}</p>
        <p className="text-sm text-ink-secondary">{m.prompts.layerLead[layer]}</p>
        {failed ? (
          <FieldError>{m.prompts.errors.load}</FieldError>
        ) : (
          <p className="mt-0.5 text-meta text-ink-muted">{status}</p>
        )}
      </div>
      <Button
        variant="secondary"
        className="shrink-0"
        disabled={state === undefined}
        onClick={() => setOpen(true)}
        aria-label={`${m.prompts.layers[layer]}: ${action}`}
      >
        {action}
      </Button>
      {open && state !== undefined && (
        <Suspense fallback={null}>
          <PromptDialog
            scope={scope}
            layer={layer}
            initial={state}
            preview={preview}
            onSaved={setState}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
