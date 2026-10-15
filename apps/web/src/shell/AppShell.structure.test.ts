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
 * Fachpunkte in fester Spalte (M4-T001): Der Fachpunkt (.lg-dot mit ml-auto) hängt am rechten Rand des
 * Fach-Links. Stand früher der Pfeil-Knopf (44 px) nur bei Fächern mit Untergruppen daneben, rutschte
 * der Punkt in den übrigen Zeilen 44 px nach rechts. Die Pfeil-Spalte muss es darum in JEDER Fachzeile
 * geben: mit Untergruppen der echte Knopf, sonst ein gleich großer, nicht klickbarer Platzhalter.
 * jsdom kann Positionen nicht messen; die Punkt-Mitte (±1 px, 6 Richtungs/Hell-Dunkel-Kombinationen)
 * misst das Skript pw/agents/m4-t001/messung.mjs im Echtbrowser (Chromium + WebKit).
 */
describe('Fachpunkte der Seitenleiste in fester Spalte', () => {
  const rowOf = () => {
    const sidebar = read('shell/Sidebar.tsx');
    const row = sidebar.match(/<div className="flex items-center">[\s\S]*?<\/div>/);
    expect(row).not.toBeNull();
    return row?.[0] ?? '';
  };

  it('der Fachpunkt hängt weiterhin am rechten Rand des Fach-Links', () => {
    expect(rowOf()).toContain('lg-dot ml-auto');
  });

  it('die Pfeil-Spalte ist an jede Fachzeile gebunden (Knopf oder Platzhalter, sonst kein Punkt-Versatz)', () => {
    const row = rowOf();
    // Bedingung mit Else-Zweig statt && (ohne Else entfiele die Spalte ja wieder)
    expect(row).toMatch(/subject\.groups\.length > 0 \? \(/);
    expect(row).not.toMatch(/subject\.groups\.length > 0 && \(/);
    // Beide Zweige reservieren dieselbe 44-px-Fläche (size-11) und geben sie nicht her (shrink-0)
    expect(row.match(/size-11 shrink-0/g)).toHaveLength(2);
  });

  it('der Platzhalter ohne Untergruppen ist nicht klickbar und ohne Inhalt', () => {
    const row = rowOf();
    expect(row).toMatch(/aria-hidden="true" className="size-11 shrink-0"/);
    expect(row).toMatch(
      /\)\s*:\s*\(\s*\/\*[\s\S]*?<span aria-hidden="true" className="size-11 shrink-0" \/>/,
    );
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

  /*
   * Fehlergrenze um die ganze Oberfläche (Befund shell-home#01): Scheitert die Seitenleiste oder die
   * Kopfzeile beim Darstellen (z. B. Fach ohne groups-Array), darf der Bildschirm nicht weiß bleiben.
   * Die zweite Grenze hängt in App.tsx um den ganzen Rahmen; die Grenze um die Ansicht bleibt an ihrer
   * Stelle in AppShell.tsx.
   */
  describe('Fehlergrenze um die ganze Oberfläche', () => {
    it('App.tsx hängt eine Vollbild-Grenze um den Rahmen (RootBoundary)', () => {
      const app = read('App.tsx');
      expect(app).toContain('<ErrorBoundary resetKey="root" fullscreen>');
      expect(app).toContain('<RootBoundary />');
    });

    it('AppShell.tsx behält die Grenze um die Ansicht (resetKey aus der Adresse)', () => {
      const shell = read('shell/AppShell.tsx');
      expect(shell).toContain('<ErrorBoundary resetKey={pageKey(route)}>');
      expect(shell).toContain('<Page route={route} />');
    });

    it('die Vollbild-Variante der Grenze bleibt ohne Bewegung (nur Stellklassen)', () => {
      const boundary = read('shell/ErrorBoundary.tsx');
      const fullscreen = boundary.match(/fullscreen[\s\S]*?'contents'/);
      expect(fullscreen).not.toBeNull();
      expect(fullscreen?.[0]).not.toMatch(/\banimate-|duration-|transition-/);
    });
  });
});
