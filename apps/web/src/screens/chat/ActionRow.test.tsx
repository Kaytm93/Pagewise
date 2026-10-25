// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../api/types';
import { MessageItem } from './MessageItem';

/*
 * Aktionszeile im Chat (F-079, notes#20; DoD M3-T023): Knopf „Als Hefteintrag speichern“ und
 * Link „Hefteintrag öffnen“ sehen im Wechsel gleich aus — einheitliche Höhe (min-h-11) und
 * dieselbe Schrift (keine eigene Textklasse: beide erben die der Zeile, im Chat text-meta).
 * Vorher hatte der Link text-sm (14 px) gegen den Knopf 13 px; die Modellangabe in der Zeile
 * sprang beim Speichern um gut 39 px. Reale Rechtecke misst jsdom nicht — das ist im
 * Echtbrowser gemessen (Chromium + WebKit, alle Richtungen, hell+dunkel).
 */

const antwort: ChatMessage = {
  id: 'n2',
  seq: 2,
  role: 'assistant',
  content: 'Ein Satz als Antwort.',
  status: 'complete',
  providerId: null,
  model: 'fake-modell',
  engineProfileId: null,
  errorCode: null,
  activity: [],
  assets: [],
  reasoning: null,
  tokensPerSecond: null,
  costUsd: null,
  createdAt: 0,
};

const saveNote = {
  subjectId: 's1',
  save: async () => ({ id: 'n1' }),
};

/** Weder Knopf noch Link setzen eine eigene Schriftgröße: beide erben die der Aktionszeile. */
function ohneEigeneSchrift(klassen: string): boolean {
  return !klassen.includes('text-sm') && !klassen.includes('text-meta');
}

describe('Aktionszeile im Chat: einheitliche Schrift und Höhe (M3-T023)', () => {
  it('Knopf „Als Hefteintrag speichern“: Bedienfläche min-h-11, keine eigene Schriftgröße', () => {
    render(
      <MessageItem
        message={antwort}
        live={false}
        thinking={false}
        canRetry={false}
        onRetry={() => {}}
        saveNote={saveNote}
      />,
    );
    const knopf = screen.getByRole('button', { name: 'Als Hefteintrag speichern' });
    expect(knopf.className).toContain('min-h-11');
    expect(ohneEigeneSchrift(knopf.className)).toBe(true);
  });

  it('Nach dem Speichern: Link „Hefteintrag öffnen“ gleiche Höhe, gleiche Schrift wie der Knopf, gleicher Abstand von Symbol und Text', async () => {
    const user = userEvent.setup();
    render(
      <MessageItem
        message={antwort}
        live={false}
        thinking={false}
        canRetry={false}
        onRetry={() => {}}
        saveNote={saveNote}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Als Hefteintrag speichern' }));
    const link = await screen.findByRole('link', { name: 'Hefteintrag öffnen' });
    expect(link.className).toContain('min-h-11');
    expect(ohneEigeneSchrift(link.className)).toBe(true);
    // Der Knopf (Button ghost) trennt Symbol und Text mit gap-2 — der Link jetzt auch,
    // damit der Übergang ohne Breitensprung der Symbol-Text-Gruppe abläuft.
    expect(link.className).toContain('gap-2');
    expect(screen.queryByRole('button', { name: 'Als Hefteintrag speichern' })).toBeNull();
  });
});
