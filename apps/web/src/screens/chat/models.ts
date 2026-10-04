import type {
  EngineKind,
  EngineProfile,
  ModelSettings,
  Provider,
  Selection,
  Subject,
} from '../../api/types';
import { format, messages as m } from '../../i18n';

export type ModelSource = 'chat' | 'subject' | 'default';

/** Was für einen Chat oder ein Fach gewählt ist: ein Modell eines Anbieters oder ein Agent-Zugang (nie beides). */
export interface Choice {
  model: Selection | null;
  engineProfileId: string | null;
}

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

/** Name des Agent-Zugangs, oder `null`, wenn es ihn nicht (mehr) gibt. */
export function engineName(engines: EngineProfile[], id: string | null): string | null {
  return engines.find((entry) => entry.id === id)?.name ?? null;
}

/** „Agent: Name“, oder `null`, wenn es den Zugang nicht (mehr) gibt. */
export function describeEngine(engines: EngineProfile[], id: string | null): string | null {
  const name = engineName(engines, id);
  return name === null ? null : format(m.chat.agentLabel, { name });
}

export interface Target {
  source: ModelSource;
  label: string;
  /** Art des Zugangs, wenn ein Agent antwortet; `null` bei einem Modell. */
  engineKind: EngineKind | null;
}

/**
 * Womit ein Chat antwortet. Gleiche Reihenfolge wie auf dem Server: Zugang des Chats, Modell des Chats,
 * Zugang des Fachs, Modell des Fachs, Standardmodell. Was es nicht mehr gibt, wird übersprungen.
 */
export function effectiveTarget(
  chat: Choice,
  subject: Pick<Subject, 'model' | 'engineProfileId'>,
  settings: ModelSettings,
  providers: Provider[],
  engines: EngineProfile[],
): Target | null {
  const candidates: [ModelSource, Choice][] = [
    ['chat', chat],
    ['subject', { model: subject.model, engineProfileId: subject.engineProfileId }],
    ['default', { model: settings.default, engineProfileId: null }],
  ];
  for (const [source, choice] of candidates) {
    const engineLabel = describeEngine(engines, choice.engineProfileId);
    if (engineLabel) {
      const kind = engines.find((entry) => entry.id === choice.engineProfileId)?.kind ?? null;
      return { source, label: engineLabel, engineKind: kind };
    }
    const label = describeSelection(providers, choice.model);
    if (label) return { source, label, engineKind: null };
  }
  return null;
}

/** Welches Modell eines Anbieters antworten würde, ohne Agenten (für „Mit API-Modell erneut“). */
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
