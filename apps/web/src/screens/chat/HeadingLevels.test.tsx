// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../api/types';
import { Markdown } from './Markdown';
import { MessageItem } from './MessageItem';

/*
 * Überschriftenebenen im Chat (chat-render#14, Chat-Teil von a11y-keyboard#2; DoD M4-T021):
 * Zwischen der H1 der Chat-Ansicht und den Nachrichten liegt kein H2-Bereich (die Nachrichtenliste
 * trägt nur ein aria-label, Werkzeug- und Agentenlisten sind keine Überschriften). Darum beginnt je
 * Nachricht die sr-only-Überschrift auf H2, und Markdown staffelt darunter ab H2 — keine Ebene wird
 * übersprungen, und innerhalb einer Antwort geht es nie wieder nach oben über die Nachricht hinaus.
 */

const frage: ChatMessage = {
  id: 'n1',
  seq: 1,
  role: 'user',
  content: 'Erkläre mir bitte quadratische Funktionen',
  status: 'complete',
  providerId: null,
  model: null,
  engineProfileId: null,
  errorCode: null,
  activity: [],
  assets: [],
  createdAt: 0,
};

function antwort(mitMarkdown: boolean): ChatMessage {
  return {
    id: 'n2',
    seq: 2,
    role: 'assistant',
    content: mitMarkdown ? '## Thema\n\nEin Satz.' : 'Nur ein Satz ohne Überschrift.',
    status: 'complete',
    providerId: null,
    model: null,
    engineProfileId: null,
    errorCode: null,
    activity: [],
    assets: [],
    createdAt: 0,
  };
}

/** Ebenenfolge der Überschriften im Dokument: Steigen um mehr als 1 ist ein Sprung. */
function pruefeFolge(ebenen: number[]): void {
  for (let i = 1; i < ebenen.length; i++) {
    const vorher = ebenen[i - 1];
    const aktuell = ebenen[i];
    if (vorher === undefined || aktuell === undefined) return;
    expect(
      aktuell - vorher,
      `Sprung bei Position ${i}: ${JSON.stringify(ebenen)}`,
    ).toBeLessThanOrEqual(1);
  }
}

describe('Überschriftenebenen im Chat (M4-T021)', () => {
  it('je Nachricht genau eine sr-only-Überschrift auf H2: „Du“ und „Antwort“', () => {
    render(
      <>
        <MessageItem
          message={frage}
          live={false}
          thinking={false}
          canRetry={false}
          onRetry={() => {}}
        />
        <MessageItem
          message={antwort(false)}
          live={false}
          thinking={false}
          canRetry={false}
          onRetry={() => {}}
        />
      </>,
    );
    const du = screen.getByRole('heading', { level: 2, name: 'Du' });
    const antwortHeading = screen.getByRole('heading', { level: 2, name: 'Antwort' });
    for (const h of [du, antwortHeading]) {
      expect(h.className).toContain('sr-only');
    }
    expect(screen.queryByRole('heading', { level: 3, name: 'Du' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 3, name: 'Antwort' })).toBeNull();
  });

  it('Ebenenfolge ohne Markdown-Überschrift: H1 → H2 (Du) → H2 (Antwort), kein Sprung', () => {
    // Die H1 der Ansicht (ChatPage) liegt in der echten Seite vor den Nachrichten; hier als Stellvertreter.
    document.body.innerHTML = '<h1>Erkläre mir bitte quadratische Funktionen</h1>';
    render(
      <>
        <MessageItem
          message={frage}
          live={false}
          thinking={false}
          canRetry={false}
          onRetry={() => {}}
        />
        <MessageItem
          message={antwort(false)}
          live={false}
          thinking={false}
          canRetry={false}
          onRetry={() => {}}
        />
      </>,
    );
    const ebenen = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) =>
      Number(h.tagName.charAt(1)),
    );
    expect(ebenen).toEqual([1, 2, 2]);
    pruefeFolge(ebenen);
  });

  it('Ebenenfolge mit Markdown-Antwort: H1 → H2 (Du) → H2 (Antwort) → H3 (Markdown-„##“), kein Sprung, kein Rückfall unter die Nachricht', () => {
    document.body.innerHTML = '<h1>Erkläre mir bitte quadratische Funktionen</h1>';
    render(
      <>
        <MessageItem
          message={frage}
          live={false}
          thinking={false}
          canRetry={false}
          onRetry={() => {}}
        />
        <MessageItem
          message={antwort(true)}
          live={false}
          thinking={false}
          canRetry={false}
          onRetry={() => {}}
        />
      </>,
    );
    const ebenen = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) =>
      Number(h.tagName.charAt(1)),
    );
    expect(ebenen).toEqual([1, 2, 2, 3]);
    pruefeFolge(ebenen);
  });

  it('Markdown bildet die Ebenen 1:1 nach unten ab (h1→h2 … h6→h6), Optik-Klassen bleiben', () => {
    document.body.innerHTML = ''; // Rückstände der Stellvertreter-H1 aus den vorigen Fällen entfernen
    render(<Markdown text={'# A\n\n## B\n\n### C\n\n#### D\n\n##### E\n\n###### F'} />);
    const paarungen: Array<[string, string]> = [
      ['A', 'h2'],
      ['B', 'h3'],
      ['C', 'h4'],
      ['D', 'h5'],
      ['E', 'h6'],
      ['F', 'h6'],
    ];
    for (const [text, ziel] of paarungen) {
      const element = screen.getByRole('heading', { level: Number(ziel.charAt(1)), name: text });
      expect(element.tagName.toLowerCase()).toBe(ziel);
    }
    // Markdown-„#“ wird keine H1 (die gehört der Ansicht) und behält seine Optik-Klassen.
    expect(document.querySelector('h1')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'A' }).className).toContain('text-xl');
  });
});
