import { z } from 'zod';

/** Höchstzahl der Modelle, die ein Anbieter in Pagewise führt. Mehr braucht niemand zum Wählen. */
export const MAX_MODELS_PER_PROVIDER = 100;

// Modell-IDs sind Bezeichner der Anbieter (z. B. „vendor/name:variant“): keine Leer- und Steuerzeichen.
// biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst abgelehnt.
const MODEL_ID = /^[^\s\u0000-\u001f\u007f]+$/;

export const modelIdField = z.string().trim().min(1).max(200).regex(MODEL_ID);

/** Ein Modell eines Anbieters mit den Fähigkeiten, die Pagewise kennen muss. */
export const ModelEntrySchema = z.strictObject({
  id: modelIdField,
  vision: z.boolean().default(false),
  tools: z.boolean().default(false),
  reasoning: z.boolean().default(false),
  streaming: z.boolean().default(true),
});
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const ModelListSchema = z
  .array(ModelEntrySchema)
  .max(MAX_MODELS_PER_PROVIDER)
  .refine((models) => new Set(models.map((model) => model.id)).size === models.length);

/**
 * Liest die gespeicherte Liste. Ist sie beschädigt, gilt sie als leer, statt den Server oder
 * die Anbieterliste lahmzulegen.
 */
export function parseStoredModels(json: string): ModelEntry[] {
  try {
    const parsed = ModelListSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Kostenlose Modelle erkennt man an der Kennung. Bei ihnen können Prompts protokolliert werden. */
export function isFreeModel(id: string): boolean {
  return id === 'openrouter/free' || id.endsWith(':free');
}

export interface Selection {
  providerId: string;
  model: string;
}

export const SelectionSchema = z.strictObject({ providerId: z.uuid(), model: modelIdField });
