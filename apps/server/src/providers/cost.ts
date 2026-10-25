import { isFreeModel } from './models';
import { isCodingPlanUrl } from './url';

/**
 * Kosten je Antwort. Berechnet wird nur bei Anbietern, die Geld je Token verlangen. Pläne (Coding Plan
 * von Z.ai, Abos von Anthropic und OpenAI), kostenlose Modelle und lokale Anbieter zeigen keine Kosten.
 *
 * Meldet der Anbieter die Kosten selbst (OpenRouter: `usage.cost`), gilt diese Zahl. Sonst rechnet Pagewise
 * mit der Preisliste unten, bisher nur für Z.ai. Eingaben aus dem Cache werden zum vollen Preis gerechnet,
 * das Ergebnis liegt dann eher zu hoch.
 *
 * Preise in US-Dollar je eine Million Tokens, Quelle: https://docs.z.ai/guides/overview/pricing (abgerufen
 * am 25. Oktober 2026; die Seite nennt kein Datum). Ändern sich die Preise, hier nachtragen.
 */
const ZAI_PRICES: Record<string, { input: number; output: number }> = {
  'glm-5.3-flash': { input: 0.15, output: 0.5 },
  'glm-5.3': { input: 1.4, output: 4.4 },
};

/** Lokale Anbieter laufen auf dem eigenen Rechner: dafür fällt nichts an. */
const LOCAL_PRESETS = new Set(['ollama', 'lmstudio']);

export interface Billing {
  preset: string;
  model: string;
  baseUrl: string;
}

export interface Usage {
  promptTokens: number | null;
  completionTokens: number | null;
  /** Vom Anbieter gemeldete Kosten in US-Dollar. */
  reported: number | null;
}

/** Kosten einer Antwort in US-Dollar, oder `null`, wenn nichts berechnet wird oder keine Zahl bekannt ist. */
export function replyCost(billing: Billing, usage: Usage): number | null {
  if (isFreeModel(billing.model) || LOCAL_PRESETS.has(billing.preset)) return null;
  if (isCodingPlanUrl(billing.baseUrl)) return null;
  if (usage.reported !== null && usage.reported > 0) return usage.reported;

  const price = billing.preset === 'zai' ? ZAI_PRICES[billing.model] : undefined;
  if (!price || usage.promptTokens === null || usage.completionTokens === null) return null;
  return (usage.promptTokens * price.input + usage.completionTokens * price.output) / 1_000_000;
}
