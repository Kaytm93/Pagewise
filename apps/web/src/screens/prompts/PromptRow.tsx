import { useEffect, useState } from 'react';
import type { PromptScope } from '../../api/types';
import { format, messages as m } from '../../i18n';
import { useSession } from '../../session/SessionProvider';
import { Button } from '../../ui/Button';
import { FieldError } from '../../ui/FieldError';
import { type PreviewTarget, PromptDialog, type PromptLayerName } from './PromptDialog';

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
  const [text, setText] = useState<string | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const scopeKey = scope.type === 'general' ? 'general' : `${scope.type}:${scope.id}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `scopeKey` bildet `scope` vollständig ab
  useEffect(() => {
    let cancelled = false;
    setText(undefined);
    setFailed(false);
    api
      .prompt(scope)
      .then((value) => {
        if (!cancelled) setText(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, scopeKey]);

  let status: string = m.prompts.statusLoading;
  if (text !== undefined) {
    status =
      text === null
        ? m.prompts.statusEmpty
        : format(m.prompts.statusSet, { count: [...text].length });
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
        disabled={text === undefined}
        onClick={() => setOpen(true)}
        aria-label={`${m.prompts.layers[layer]}: ${text ? m.prompts.edit : m.prompts.define}`}
      >
        {text ? m.prompts.edit : m.prompts.define}
      </Button>
      {open && text !== undefined && (
        <PromptDialog
          scope={scope}
          layer={layer}
          initial={text}
          preview={preview}
          onSaved={setText}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
