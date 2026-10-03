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
