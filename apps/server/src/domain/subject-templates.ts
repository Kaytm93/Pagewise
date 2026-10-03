import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { nameField } from '../http/fields';

const MAX_TEMPLATES = 50;

const templateFile = z.object({
  version: z.literal(1),
  subjects: z.array(z.object({ name: nameField })).max(MAX_TEMPLATES),
});

/**
 * Neutrale Vorlagen für das Onboarding (nur Fachnamen) aus einer Datei, standardmäßig
 * `config/examples/subjects.example.json`. Ist die Datei weg oder kaputt, gibt es keine Vorlagen.
 * Die Namen werden nie angelegt, bevor der Nutzer sie auswählt.
 */
export function loadSubjectTemplates(file: string): { name: string }[] {
  try {
    const parsed = templateFile.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (!parsed.success) return [];
    const seen = new Set<string>();
    return parsed.data.subjects.filter(({ name }) => {
      const key = name.toLocaleLowerCase('de');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch {
    return [];
  }
}
