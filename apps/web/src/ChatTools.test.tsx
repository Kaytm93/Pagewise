// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer } from './test/fake-server';

const MODEL = { id: 'modell-a', vision: false, tools: true, reasoning: false, streaming: true };

function setup() {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispiel-Chemie');
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

beforeAll(async () => {
  await import('./screens/chat/ChatPage');
}, 30_000);
beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(() => window.history.replaceState(null, '', '/'));

describe('Chat: Werkzeuge des Modells', () => {
  it('zeigt an der fertigen Antwort, welche Daten abgefragt wurden, nie die Daten selbst', async () => {
    const { server, subject, chat } = setup();
    server.addMessage(chat.id, 'user', 'Wann schreibe ich den nächsten Test?');
    server.addMessage(chat.id, 'assistant', 'Am Donnerstag.', {
      activity: [
        { id: '0', tool: 'get_exams', target: null, state: 'done' },
        { id: '1', tool: 'get_timetable', target: 'Donnerstag', state: 'done' },
      ],
    });
    open(server, chatPath(subject.id, chat.id));
    expect(await screen.findByText('Am Donnerstag.')).toBeTruthy();
    const notes = within(screen.getByRole('list', { name: 'Abgefragte Daten' }));
    expect(notes.getByText('Tests eingesehen')).toBeTruthy();
    expect(notes.getByText('Stundenplan eingesehen: Donnerstag')).toBeTruthy();
    // Es ist kein Agent, also kein eingeklapptes „Was der Agent getan hat“.
    expect(screen.queryByText(/Was der Agent getan hat/)).toBeNull();
  });

  it('zeigt während der Antwort, dass gerade abgefragt wird, und danach das Ergebnis', async () => {
    const { server, subject, chat } = setup();
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('textbox', { name: 'Nachricht' }));
    await user.paste('Was habe ich morgen?');
    await user.click(screen.getByRole('button', { name: 'Senden' }));
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    const generation = server.generation(chat.id);

    act(() =>
      generation.activity({ id: 'tool-0', tool: 'get_timetable', target: null, state: 'running' }),
    );
    const list = await screen.findByRole('list', { name: 'Abgefragte Daten' });
    expect(within(list).getByText('Stundenplan eingesehen')).toBeTruthy();
    expect(within(list).getByText('wird abgefragt')).toBeTruthy();

    act(() => {
      generation.activity({ id: 'tool-0', tool: 'get_timetable', target: null, state: 'done' });
      generation.delta('Morgen hast du Chemie.');
      generation.finish();
    });
    expect(await screen.findByText('Morgen hast du Chemie.')).toBeTruthy();
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Abgefragte Daten' })).getByText('abgefragt'),
      ).toBeTruthy(),
    );
  });

  it('markiert einen fehlgeschlagenen Aufruf', async () => {
    const { server, subject, chat } = setup();
    server.addMessage(chat.id, 'user', 'Frage');
    server.addMessage(chat.id, 'assistant', 'Das ging nicht.', {
      activity: [{ id: '0', tool: 'get_exams', target: null, state: 'error' }],
    });
    open(server, chatPath(subject.id, chat.id));
    const list = await screen.findByRole('list', { name: 'Abgefragte Daten' });
    expect(within(list).getByText('nicht möglich')).toBeTruthy();
  });
});

describe('Einstellungen: Stundenplan und Tests für die KI', () => {
  it('zeigt den Schalter an, erklärt ihn und speichert die Wahl', async () => {
    const server = new FakeServer('unlocked');
    open(server, '/settings');
    const user = userEvent.setup();
    const box = (await screen.findByRole('checkbox', {
      name: /KI darf Stundenplan und Tests einsehen/,
    })) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(
      screen.getByText(/nur an den Anbieter, wenn das Modell sie über ein Werkzeug anfordert/),
    ).toBeTruthy();
    await user.click(box);
    await waitFor(() => expect(server.toolsEnabled).toBe(false));
    expect(server.calls('PUT', '/api/tool-settings')[0]?.body).toEqual({ enabled: false });
    expect(box.checked).toBe(false);
  });

  it('stellt die Anzeige zurück und sagt es, wenn das Speichern scheitert', async () => {
    const server = new FakeServer('unlocked');
    open(server, '/settings');
    const user = userEvent.setup();
    const box = (await screen.findByRole('checkbox', {
      name: /KI darf Stundenplan und Tests einsehen/,
    })) as HTMLInputElement;
    server.replyOnce('PUT', '/api/tool-settings', () => new Response('{}', { status: 500 }));
    await user.click(box);
    expect(
      await screen.findByText('Die Einstellung konnte nicht gespeichert werden.'),
    ).toBeTruthy();
    expect(box.checked).toBe(true);
    expect(server.toolsEnabled).toBe(true);
  });

  it('zeigt einen ausgeschalteten Schalter beim Öffnen', async () => {
    const server = new FakeServer('unlocked');
    server.toolsEnabled = false;
    open(server, '/settings');
    const box = (await screen.findByRole('checkbox', {
      name: /KI darf Stundenplan und Tests einsehen/,
    })) as HTMLInputElement;
    expect(box.checked).toBe(false);
  });
});
