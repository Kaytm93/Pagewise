// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../api/types';
import { messages as m } from '../../i18n';
import { MessageItem } from './MessageItem';

/*
 * Automatische Korrektur als solche erkennbar (F-080, M4-T026): Die von Pagewise selbst gesendete
 * Korrektur-Anfrage beginnt mit dem festen Anfang `m.chat.autoFix.prefix`. Solche Nachrichten tragen
 * über der Blase einen kurzen Hinweis (role="note"), gewöhnliche Nutzernachrichten bleiben ohne ihn.
 */

function nutzer(inhalt: string): ChatMessage {
  return {
    id: 'n1',
    seq: 1,
    role: 'user',
    content: inhalt,
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

describe('Kennzeichnung der automatischen Korrektur (M4-T026)', () => {
  it('Korrektur-Anfrage: sichtbarer Hinweis (role="note") über der Blase, Inhalt unverändert', () => {
    const inhalt = `${m.chat.autoFix.prefix}\nZeile mit den Fehlercodes`;
    const { container } = render(
      <MessageItem
        message={nutzer(inhalt)}
        live={false}
        thinking={false}
        canRetry={false}
        onRetry={() => {}}
      />,
    );
    const hinweis = screen.getByRole('note');
    expect(hinweis.textContent).toBe(m.chat.autoFix.hinweis);
    expect(hinweis.getAttribute('data-autofix-hinweis')).toBe('true');
    // Hinweis steht über der Blase, kein Knopf/Dialog: nur ein Absatz.
    expect(hinweis.tagName).toBe('P');
    const blasen = container.querySelectorAll('article > p');
    const blase = blasen[blasen.length - 1];
    expect(blase).toBeTruthy();
    expect(blase?.textContent).toBe(inhalt);
    // Die Blase selbst bleibt eine gewöhnliche Nutzernachricht (keine neue Optik, keine Überschrift im Hinweis).
    expect(container.querySelector('h2')?.className).toContain('sr-only');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('Gewöhnliche Nutzernachricht: kein Hinweis', () => {
    render(
      <MessageItem
        message={nutzer('Erkläre mir bitte quadratische Funktionen')}
        live={false}
        thinking={false}
        canRetry={false}
        onRetry={() => {}}
      />,
    );
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByText(m.chat.autoFix.hinweis)).toBeNull();
  });

  it('Antwort des Modells: nie der Korrektur-Hinweis, auch wenn der Text mit dem Anfang beginnt', () => {
    const antwort: ChatMessage = {
      id: 'n2',
      seq: 2,
      role: 'assistant',
      content: `${m.chat.autoFix.prefix} zitiert im Text`,
      status: 'complete',
      providerId: null,
      model: null,
      engineProfileId: null,
      errorCode: null,
      activity: [],
      assets: [],
      createdAt: 0,
    };
    render(
      <MessageItem
        message={antwort}
        live={false}
        thinking={false}
        canRetry={false}
        onRetry={() => {}}
      />,
    );
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByText(m.chat.autoFix.hinweis)).toBeNull();
  });
});
