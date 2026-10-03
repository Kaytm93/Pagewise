import { z } from 'zod';

// Steuerzeichen (Zeilenumbrüche, Tabs, NUL) haben in Namen und kurzen Angaben nichts verloren.
// biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst abgelehnt.
const NO_CONTROL_CHARACTERS = /^[^\u0000-\u001f\u007f]*$/;

/** Name eines Fachs oder einer Untergruppe: 1 bis 80 Zeichen, umgebende Leerzeichen entfallen. */
export const nameField = z.string().trim().min(1).max(80).regex(NO_CONTROL_CHARACTERS);

/** Kurze Profilangabe: höchstens 80 Zeichen, leer bedeutet „nicht angegeben“ (null). */
export const optionalTextField = z
  .string()
  .trim()
  .max(80)
  .regex(NO_CONTROL_CHARACTERS)
  .transform((value) => (value === '' ? null : value))
  .nullable();

export const idField = z.uuid();

/** Kennung eines Linien-Icons (z. B. „book“). Unbekannte Kennungen zeigt die Oberfläche als Standard-Icon. */
export const iconField = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,23}$/)
  .nullable();

/** Wochenstunden eines Fachs: ganze Zahl von 1 bis 40, `null` für „nicht angegeben“. */
export const hoursField = z.number().int().min(1).max(40).nullable();

/** Längster Prompt (eine Schicht) in Zeichen. Reicht für mehrere Seiten und bleibt für das Modell handhabbar. */
export const PROMPT_MAX_CHARACTERS = 20_000;

/**
 * Prompt-Text: Zeilenumbrüche und Tabs sind erlaubt, andere Steuerzeichen nicht. Windows-Zeilenenden
 * werden vereinheitlicht, ein leerer Text bedeutet „nicht gesetzt“ (null).
 */
export const promptField = z
  .string()
  .max(PROMPT_MAX_CHARACTERS)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst abgelehnt.
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
  .transform((value) => {
    const unified = value.replace(/\r\n?/g, '\n');
    return unified.trim() === '' ? null : unified;
  })
  .nullable();

/** Titel eines Chats: 1 bis 120 Zeichen, umgebende Leerzeichen entfallen. */
export const titleField = z.string().trim().min(1).max(120).regex(NO_CONTROL_CHARACTERS);

/** Längste Nachricht des Nutzers in Zeichen (siehe chats/history.ts). */
export const MESSAGE_MAX_CHARACTERS = 50_000;

/**
 * Nachricht des Nutzers: nicht leer, höchstens {@link MESSAGE_MAX_CHARACTERS} Zeichen. Zeilenumbrüche
 * und Tabs sind erlaubt, andere Steuerzeichen nicht.
 */
export const messageField = z
  .string()
  .max(MESSAGE_MAX_CHARACTERS)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier bewusst abgelehnt.
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
  .refine((value) => value.trim() !== '');
