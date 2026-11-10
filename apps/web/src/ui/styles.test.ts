import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { emptyState, listRowAction, listRowHost, listRowLead } from './styles';

/*
 * D-108: Ein Knopf am Ende einer Listenzeile sitzt in der Zeile. Früher stand er als eigene Spalte daneben und
 * ragte mit `-mr-2` über den rechten Rand der Liste; Trennlinie und Hover endeten vor ihm.
 */

const src = join(dirname(fileURLToPath(import.meta.url)), '..');

function quelltexte(dir: string): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return quelltexte(path);
    if (!entry.name.endsWith('.tsx') || entry.name.includes('.test.')) return [];
    return [{ file: path.slice(src.length + 1), text: readFileSync(path, 'utf8') }];
  });
}

describe('Zeile mit Knopf am Ende (D-108)', () => {
  it('verankert den Knopf im li und hält in der Zeile Platz für ihn frei', () => {
    expect(listRowHost.split(' ')).toContain('relative');
    expect(listRowLead.split(' ')).toEqual(
      expect.arrayContaining(['lg-row', 'lg-row-lead', 'pr-14']),
    );
    expect(listRowAction.split(' ')).toEqual(
      expect.arrayContaining(['lg-row-action', 'absolute', 'inset-y-0', 'right-1', 'my-auto']),
    );
  });

  it('hat 44 px Zielgröße, einen gedrückten und einen deaktivierten Zustand', () => {
    expect(listRowAction.split(' ')).toEqual(
      expect.arrayContaining(['size-11', 'mo-press', 'disabled:opacity-50']),
    );
  });

  it('lässt keinen 44-px-Knopf mehr mit negativem Rand über seine Liste ragen', () => {
    // Der Schließen-Knopf im Dialogkopf (ui/modal.tsx) steht nicht in einer Liste und hat Polster um sich.
    for (const { file, text } of quelltexte(join(src, 'screens'))) {
      expect(text, file).not.toMatch(/-m[rlx]-2 inline-flex size-11/);
    }
    expect(listRowAction).not.toMatch(/(^|\s)-m[rlx]-/);
  });
});

describe('Leerer Zustand (D-111)', () => {
  it('ist eine gemeinsame Klasse mit Haken für die Richtungen und 16 px Polster', () => {
    expect(emptyState.split(' ')).toEqual(['lg-empty', 'rounded-box', 'bg-paper', 'p-4']);
  });

  it('wird von den Listen genutzt, statt die Klassen zu wiederholen', () => {
    const dateien = quelltexte(src).filter(({ text }) => text.includes('{emptyState}'));
    expect(dateien.length).toBeGreaterThanOrEqual(8);
    for (const file of [
      'screens/chat/ChatList.tsx',
      'screens/notes/NoteList.tsx',
      'screens/SubjectPage.tsx',
    ]) {
      expect(dateien.map((eintrag) => eintrag.file)).toContain(file);
    }
  });
});
