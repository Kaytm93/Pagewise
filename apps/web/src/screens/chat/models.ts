import type { ModelSettings, Provider, Selection, Subject } from '../../api/types';

export type ModelSource = 'chat' | 'subject' | 'default';

/** „Anbieter · Modell“, oder `null`, wenn es den Anbieter oder das Modell nicht (mehr) gibt. */
export function describeSelection(
  providers: Provider[],
  selection: Selection | null,
): string | null {
  if (!selection) return null;
  const provider = providers.find((entry) => entry.id === selection.providerId);
  if (!provider?.models.some((model) => model.id === selection.model)) return null;
  return `${provider.name} · ${selection.model}`;
}

/** Welches Modell antwortet: das des Chats, sonst das des Fachs, sonst das Standardmodell. */
export function effectiveModel(
  chatModel: Selection | null,
  subject: Pick<Subject, 'model'>,
  settings: ModelSettings,
  providers: Provider[],
): { source: ModelSource; label: string } | null {
  const candidates: [ModelSource, Selection | null][] = [
    ['chat', chatModel],
    ['subject', subject.model],
    ['default', settings.default],
  ];
  for (const [source, selection] of candidates) {
    const label = describeSelection(providers, selection);
    if (label) return { source, label };
  }
  return null;
}

export interface ModelOption {
  key: string;
  label: string;
  free: boolean;
}

export function modelOptions(providers: Provider[]): ModelOption[] {
  return providers.flatMap((provider) =>
    provider.models.map((model) => ({
      key: `${provider.id}|${model.id}`,
      label: `${provider.name} · ${model.id}`,
      free: model.free,
    })),
  );
}
