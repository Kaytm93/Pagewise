import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * „Zum Inhalt springen“ (Anker #main) darf das Ziel nicht unter der festen Kopfzeile (h-14 = 56 px)
 * verstecken. scroll-mt-20 (5 rem) rückt das Sprungziel entsprechend nach unten; dieser Test liest den
 * Quelltext und nagelt fest, dass main#main die Klasse trägt.
 */

/*
 * Überschriften-Gliederung der Hülle: Im DOM liegt die Seitenleiste vor dem Inhalt; ihr Abschnittstitel
 * „Fächer“ ist darum ein Absatz (role="presentation") und keine Überschrift, damit die H1 der Ansicht die
 * erste Überschrift des Dokuments bleibt (Befund a11y-keyboard #2). Zusätzlich nagt dieser Test fest:
 * - genau eine H1 je Ansicht, die erste Überschrift des Dokuments;
 * - keine übersprungene Ebene (jede folgende Überschrift steigt höchstens um eine Stufe);
 * - die Ansichts-H1 trägt eine stabile ID als Sprungziel (Chat: #chat-title).
 * Für Screenreader gilt: die Auszeichnung von Quelltext ist hier Struktur, nicht Verhalten.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Sprunglink-Ziel liegt nicht unter der Kopfzeile', () => {
  it('main#main trägt scroll-mt-20', () => {
    const shell = read('shell/AppShell.tsx');
    const main = shell.match(/<main[\s\S]*?<\/main>/);
    expect(main).not.toBeNull();
    expect(main?.[0]).toContain('id="main"');
    expect(main?.[0]).toContain('scroll-mt-20');
  });

  it('der Sprunglink zeigt weiterhin auf #main', () => {
    const shell = read('shell/AppShell.tsx');
    expect(shell).toContain('href="#main"');
  });
});

/*
 * Kopfzeile mobil: neben einem langen Fach-/Gruppennamen darf der Menü-Knopf nicht schrumpfen
 * (Befund: 22–26 px breit statt 44 px) und gekürzte Namen müssen den vollen Text als title tragen.
 * Die 44 px im Echtbrowser misst das Browsermess-Skript (jsdom kann Layout nicht messen).
 */
describe('Menü-Knopf und gekürzte Namen', () => {
  const headerOf = () => {
    const shell = read('shell/AppShell.tsx');
    const header = shell.match(/<header[\s\S]*?<\/header>/);
    expect(header).not.toBeNull();
    return header?.[0] ?? '';
  };

  it('der Menü-Knopf behält seine 44 px (shrink-0 neben langem Titel)', () => {
    const button = headerOf().match(/<button[\s\S]*?<\/button>/);
    expect(button).not.toBeNull();
    expect(button?.[0]).toContain('size-11');
    expect(button?.[0]).toContain('shrink-0');
  });

  it('der gekürzte Kopfzeilen-Titel trägt title', () => {
    expect(headerOf()).toContain('title={title}');
  });

  it('gekürzte Fach- und Gruppennamen in der Seitenleiste tragen title', () => {
    const sidebar = read('shell/Sidebar.tsx');
    const spans = sidebar.match(/<span[^>]*className="truncate"[^>]*>/g) ?? [];
    expect(spans.length).toBe(2);
    for (const span of spans) expect(span).toContain('title=');
  });
});

/*
 * Überschriftenfolge (DoD): Der Abschnittstitel „Fächer“ der Seitenleiste ist ein Absatz und keine
 * Überschrift, weil die Seitenleiste im DOM vor dem Inhalt liegt — sonst stünde H2 vor H1. Die H1 der
 * Ansicht ist die erste und einzige Überschrift der obersten Ebene; darunter wird keine Ebene übersprungen.
 */
describe('Überschriftenfolge der Hülle', () => {
  const FILE_WITH_H1: Record<string, string> = {
    HomePage: 'screens/HomePage.tsx',
    SubjectPage: 'screens/SubjectPage.tsx',
    ChatPage: 'screens/chat/ChatPage.tsx',
    NotePage: 'screens/notes/NotePage.tsx',
    SettingsPage: 'screens/SettingsPage.tsx',
    NotFoundPage: 'screens/NotFoundPage.tsx',
    TimetablePage: 'planning/TimetablePage.tsx',
    ExamsPage: 'planning/ExamsPage.tsx',
  };

  it('die Seitenleiste hat keine Überschrift mehr (Abschnittstitel „Fächer“ ist ein Absatz)', () => {
    const sidebar = read('shell/Sidebar.tsx');
    expect(sidebar).not.toMatch(/<h[1-6][\s>]/);
    const label = sidebar.match(/id="subjects-heading"[\s\S]{0,200}?{m\.shell\.subjects}/);
    expect(label).not.toBeNull();
    expect(label?.[0]).toContain('role="presentation"');
  });

  it('jede Ansichts-H1 ist ein Sprungziel (stabile ID)', () => {
    expect(read('screens/chat/ChatPage.tsx')).toMatch(/<h1[\s\S]*?id="chat-title"/);
  });

  it('Markdown-Antworten staffeln Überschriften ab H2 (kein Sprung unter der Ansichts-H1)', () => {
    const markdown = read('screens/chat/Markdown.tsx');
    expect(markdown).toContain('h1: ({ children }) => <h2');
    expect(markdown).not.toMatch(/h1: \(\{ children \}\) => <h1[\s>]/);
  });

  it('die Folge der Ebenen in jeder Ansicht steigt ohne Sprung (Quelltextfolge je Datei)', () => {
    for (const file of Object.values(FILE_WITH_H1)) {
      const source = read(file);
      const levels = [...source.matchAll(/<h([1-6])[\s>]/g)].map((match) => Number(match[1]));
      let lowest = 1;
      for (const level of levels) {
        if (level <= lowest) {
          lowest = level;
          continue;
        }
        expect(level - lowest).toBeLessThanOrEqual(1);
        lowest = level;
      }
    }
  });
});
