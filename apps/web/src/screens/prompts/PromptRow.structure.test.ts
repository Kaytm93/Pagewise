import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

/*
 * Die Prompt-Zeile darf den Text auf schmalen Breiten (390 px) nicht in eine schmale Spalte
 * pressen: Der Knopf muss unter den Text rutschen (Vorbild: Modell-Zeile in SubjectModel).
 * jsdom kann Layout nicht messen; dieser Test nagelt die Klassen am Quelltext fest, die
 * Breite selbst wird im Echtbrowser gemessen (Skript ~/pagewise-agent/pw/agents/m3-t003/).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Prompt-Zeile bricht auf schmalen Breiten um', () => {
  it('PromptRow: Zeile darf umbrechen und der Knopf nicht schrumpfen', () => {
    const row = read('screens/prompts/PromptRow.tsx');
    const container = row.match(/<div className="flex[^"]*"[^>]*>/);
    expect(container).not.toBeNull();
    expect(container?.[0]).toContain('flex-wrap');
    expect(container?.[0]).toContain('gap-y-');
    const button = row.match(/<Button[\s\S]*?\/>/);
    expect(button?.[0]).toContain('shrink-0');
  });

  it('PromptRow: Textspalte behält eine Mindestbreite (Knopf rutscht darunter, bevor der Text zu schmal wird)', () => {
    const row = read('screens/prompts/PromptRow.tsx');
    const column = row.match(/<div className="min-w-0[^"]*">/);
    expect(column).not.toBeNull();
    expect(column?.[0]).toContain('min-w-52');
  });

  it('SubjectModel: Textspalte der Modell-Zeile setzt den gleichen Umbruchpunkt', () => {
    const model = read('screens/chat/SubjectModel.tsx');
    const column = model.match(/<div className="min-w-0[^"]*">/);
    expect(column).not.toBeNull();
    expect(column?.[0]).toContain('min-w-52');
  });
});
