/**
 * Vorlagen für „Einfügen“ im Editor: kleine, gültige Beispiele für jede Blockart. Sie enthalten nur Technik und
 * erfundene Beispieldaten, keine Schulinhalte. Ein Test prüft, dass die App jede Vorlage zeichnen kann.
 */
export type TemplateKey =
  | 'formula'
  | 'graph'
  | 'mol'
  | 'abc'
  | 'merksatz'
  | 'beispiel'
  | 'aufgabe'
  | 'definition';

export const TEMPLATES: Record<TemplateKey, string> = {
  formula: '$$\na^2 + b^2 = c^2\n$$',
  graph:
    '```graph\n{"functions":[{"expr":"x^2-4","label":"f(x)"}],"x":[-4,4],"y":[-6,6],"points":[{"x":2,"y":0,"label":"N"}]}\n```',
  mol: '```mol\nH2O\n```',
  abc: '```abc\nX:1\nM:4/4\nL:1/4\nK:C\nCDEF|GABc|\n```',
  merksatz: '> [!merksatz]\n> Hier steht der Merksatz.',
  beispiel: '> [!beispiel]\n> Hier steht ein Beispiel.',
  aufgabe: '> [!aufgabe]\n> Hier steht die Aufgabe.',
  definition: '> [!definition]\n> Hier steht die Definition.',
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[];
