import type { ModelEntry } from './models';

/**
 * Voreinstellungen sind nur Vorschläge: Alles bleibt in der Oberfläche änderbar, und jeder
 * OpenAI-kompatible Anbieter geht auch ohne Voreinstellung („custom“).
 *
 * Stand 3. Oktober 2026, geprüft gegen die Dokumentation der Anbieter (Quellen: docs/decisions.md, D-024).
 */
export interface Preset {
  id: 'openrouter' | 'zai' | 'ollama' | 'lmstudio' | 'custom';
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

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}
