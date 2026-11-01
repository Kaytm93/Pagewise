import type { ModelEntry } from './models';

/**
 * Voreinstellungen sind nur Vorschläge: Alles bleibt in der Oberfläche änderbar, und jeder
 * OpenAI-kompatible Anbieter geht auch ohne Voreinstellung („custom“).
 *
 * Stand 3. Oktober 2026, geprüft gegen die Dokumentation der Anbieter (Quellen: docs/decisions.md, D-024).
 */
export type PresetId =
  | 'openrouter'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'mistral'
  | 'groq'
  | 'deepseek'
  | 'xai'
  | 'zai'
  | 'ollama'
  | 'lmstudio'
  | 'custom';

export interface Preset {
  id: PresetId;
  baseUrl: string;
  requiresKey: boolean;
  /** Modelle, die beim Anlegen vorgeschlagen werden. */
  models: ModelEntry[];
  /** Modell, das als Standard gesetzt wird, falls noch keines gewählt ist. */
  defaultModel: string | null;
  /** Modell, auf das bei Fehlern und Rate-Limits ausgewichen wird, falls noch keine Kette besteht. */
  fallbackModel: string | null;
}

const model = (id: string, vision: boolean, tools: boolean, reasoning: boolean): ModelEntry => ({
  id,
  vision,
  tools,
  reasoning,
  streaming: true,
});

/** Voreinstellung für einen Anbieter mit OpenAI-kompatibler Schnittstelle ohne vorgeschlagene Modelle (Liste laden). */
const compatible = (id: PresetId, baseUrl: string): Preset => ({
  id,
  baseUrl,
  requiresKey: true,
  models: [],
  defaultModel: null,
  fallbackModel: null,
});

export const PRESETS: readonly Preset[] = [
  {
    id: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    requiresKey: true,
    models: [
      model('z-ai/glm-5.3-flash', true, true, true),
      model('openrouter/free', true, true, true),
    ],
    defaultModel: 'z-ai/glm-5.3-flash',
    fallbackModel: 'z-ai/glm-5.3-flash',
  },
  // Weitere Anbieter (D-076). Adressen laut Dokumentation der Anbieter, Stand 1. November 2026; Modelle schlägt
  // Pagewise nicht vor, weil sich ihre Namen oft ändern: „Vom Anbieter laden“ liest die aktuelle Liste.
  compatible('openai', 'https://api.openai.com/v1'),
  compatible('anthropic', 'https://api.anthropic.com/v1'),
  compatible('gemini', 'https://generativelanguage.googleapis.com/v1beta/openai'),
  compatible('mistral', 'https://api.mistral.ai/v1'),
  compatible('groq', 'https://api.groq.com/openai/v1'),
  compatible('deepseek', 'https://api.deepseek.com/v1'),
  compatible('xai', 'https://api.x.ai/v1'),
  {
    // Allgemeine Pay-per-Token-API. Der Coding Plan hat einen eigenen Endpunkt und ist hier bewusst
    // kein Preset (D-011); sein Kontingent zählt auf dieser Adresse nicht (Fehler 1113, D-036).
    // Modellkennungen laut https://docs.z.ai/devpack/tool/claude und .../guides/overview/overview,
    // Stand 3. Oktober 2026. Fähigkeiten wie bei OpenRouter (D-024), änderbar.
    id: 'zai',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    requiresKey: true,
    models: [model('glm-5.3-flash', true, true, true), model('glm-5.3', false, true, true)],
    defaultModel: null,
    fallbackModel: null,
  },
  {
    id: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    requiresKey: false,
    models: [],
    defaultModel: null,
    fallbackModel: null,
  },
  {
    id: 'lmstudio',
    baseUrl: 'http://localhost:1234/v1',
    requiresKey: false,
    models: [],
    defaultModel: null,
    fallbackModel: null,
  },
  {
    id: 'custom',
    baseUrl: '',
    requiresKey: false,
    models: [],
    defaultModel: null,
    fallbackModel: null,
  },
];

/** Alle Kennungen der Voreinstellungen, für die Prüfung der Anfragen. */
export const PRESET_IDS = PRESETS.map((preset) => preset.id) as [PresetId, ...PresetId[]];

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}
