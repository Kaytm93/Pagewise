// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { ApiClient } from '../../api/client';
import type { ActivityEntry } from '../../api/types';
import { FakeServer } from '../../test/fake-server';
import { AgentActivity } from './AgentActivity';

/*
 * M1-T3: Die Chatansicht bekommt in „Lagen“ eine eigene Komposition aus Fachkante, Werkzeugzeile,
 * Statuszeile und umrandetem Composer-Feld. „Raum“ und „Atelier“ behalten den bisherigen Aufbau.
 * Alle Namen sind erfunden.
 */

const MODEL = { id: 'modell-a', vision: false, tools: true, reasoning: false, streaming: true };

function setup() {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach Lagen');
  const provider = server.addProvider('Anbieter A', {
    models: [{ ...MODEL, free: false }],
    hasKey: true,
  });
  server.modelSettings = { default: { providerId: provider.id, model: 'modell-a' }, fallback: [] };
  const chat = server.addChat(subject.id);
  return { server, subject, chat };
}

function open(server: FakeServer, path: string) {
  window.history.replaceState(null, '', path);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

const chatPath = (subjectId: string, chatId: string) => `/subjects/${subjectId}/chats/${chatId}`;

// Die Chatansicht wird beim ersten Öffnen nachgeladen; einmal vorab laden wie in Chat.test.tsx.
beforeAll(async () => {
  await import('./ChatPage');
}, 30_000);

afterEach(() => {
  document.documentElement.removeAttribute('data-design');
  window.history.replaceState(null, '', '/');
});

describe('Chat in „Lagen“', () => {
  it('zeigt Fachkante, umrandetes Composer-Feld und die Statuszeile', async () => {
    document.documentElement.setAttribute('data-design', 'lagen');
    const { server, subject, chat } = setup();
    const { container } = open(server, chatPath(subject.id, chat.id));

    await screen.findByRole('heading', { level: 1, name: 'Neuer Chat' });

    expect(container.querySelector('.lg-chat-kante')).not.toBeNull();
    expect(container.querySelector('.lg-composer-field')).not.toBeNull();

    const hint = container.querySelector('.lg-chat-hint');
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain('Anbieter A · modell-a');
    expect(hint?.textContent).toContain('Antworten bitte prüfen');

    // Der vorhandene Modell-Knopf behält seinen zugänglichen Namen.
    expect(
      screen.getByRole('button', { name: 'Modell wählen: Anbieter A · modell-a' }),
    ).toBeTruthy();
  });
});

describe('Chat in „Raum“', () => {
  it('behält den bisherigen Kopf ohne Fachkante und ohne Statuszeile', async () => {
    document.documentElement.setAttribute('data-design', 'raum');
    const { server, subject, chat } = setup();
    const { container } = open(server, chatPath(subject.id, chat.id));

    await screen.findByRole('heading', { level: 1, name: 'Neuer Chat' });

    expect(container.querySelector('.lg-chat-kante')).toBeNull();
    expect(container.querySelector('.lg-chat-hint')).toBeNull();
    expect(container.querySelector('.lg-composer-field')).toBeNull();
  });
});

describe('Werkzeugzeile in „Lagen“', () => {
  it('zeigt bei laufendem Schritt einen Punkt und bei fertigem einen Haken', () => {
    document.documentElement.setAttribute('data-design', 'lagen');
    const step: ActivityEntry = {
      id: 't1',
      tool: 'get_timetable',
      target: null,
      state: 'running',
    };
    const { container, rerender } = render(<AgentActivity steps={[step]} live />);

    expect(container.querySelector('.lg-tool-dot')).not.toBeNull();
    expect(container.querySelector('.lg-tool-check')).toBeNull();

    rerender(<AgentActivity steps={[{ ...step, state: 'done' }]} live />);

    expect(container.querySelector('.lg-tool-dot')).toBeNull();
    expect(container.querySelector('.lg-tool-check')).not.toBeNull();
  });
});
