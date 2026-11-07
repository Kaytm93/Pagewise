// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer } from './test/fake-server';

const MODEL = { id: 'modell-a', vision: false, tools: true, reasoning: false, streaming: true };

// Alle Inhalte sind erfunden.
const DOCUMENT = {
  title: 'Beispiel-Arbeitsblatt Wasser',
  parts: [
    { type: 'heading', text: 'Aufgabe 1' },
    { type: 'paragraph', text: 'Beschreibe den Aufbau von Wasser.' },
  ],
};
const SLIDES = {
  title: 'Beispiel-Vortrag',
  slides: [{ title: 'Einstieg', bullets: ['Punkt A'] }],
};

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
  await import('./screens/chat/blocks/DocumentView');
  await import('./screens/chat/blocks/SlidesView');
  await import('./screens/chat/blocks/SheetView');
  await import('./screens/chat/blocks/FigureView');
}, 30_000);
beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(() => window.history.replaceState(null, '', '/'));

describe('Chat: vom Modell angelegte Dateien', () => {
  it('zeigt ein Dokument mit Vorschau und PDF-Knopf unter der Antwort', async () => {
    const { server, subject, chat } = setup();
    server.artifacts.set('d1', {
      id: 'd1',
      kind: 'document',
      title: DOCUMENT.title,
      version: 1,
      spec: JSON.stringify(DOCUMENT),
    });
    server.addMessage(chat.id, 'user', 'Mach mir ein Arbeitsblatt.');
    server.addMessage(chat.id, 'assistant', 'Das Arbeitsblatt steht bereit.', {
      artifacts: [{ id: 'd1', kind: 'document', title: DOCUMENT.title, version: 1 }],
      activity: [
        { id: '0', tool: 'create_document', target: DOCUMENT.title, file: null, state: 'done' },
      ],
    });
    open(server, chatPath(subject.id, chat.id));
    expect(await screen.findByText('Das Arbeitsblatt steht bereit.')).toBeTruthy();
    const files = await screen.findByRole('region', { name: 'Dateien dieser Antwort' });
    expect(await screen.findByText('Beschreibe den Aufbau von Wasser.')).toBeTruthy();
    expect(files.querySelector('button')?.textContent).toBe('Als PDF herunterladen');
    expect(screen.getByText(`Dokument erstellt: ${DOCUMENT.title}`)).toBeTruthy();
  });

  it('zeigt eine Präsentation mit PowerPoint-Knopf', async () => {
    const { server, subject, chat } = setup();
    server.artifacts.set('s1', {
      id: 's1',
      kind: 'slides',
      title: SLIDES.title,
      version: 1,
      spec: JSON.stringify(SLIDES),
    });
    server.addMessage(chat.id, 'assistant', 'Die Folien stehen bereit.', {
      artifacts: [{ id: 's1', kind: 'slides', title: SLIDES.title, version: 1 }],
    });
    open(server, chatPath(subject.id, chat.id));
    expect(
      await screen.findByRole('button', { name: 'Als PowerPoint herunterladen' }),
    ).toBeTruthy();
  });

  it('zeigt eine Tabellendatei mit Excel- und CSV-Knopf', async () => {
    const { server, subject, chat } = setup();
    const sheet = {
      title: 'Beispiel-Noten',
      sheets: [{ name: 'Tabelle1', header: ['Name', 'Punkte'], rows: [['Beispiel A', 12.5]] }],
    };
    server.artifacts.set('t1', {
      id: 't1',
      kind: 'sheet',
      title: sheet.title,
      version: 1,
      spec: JSON.stringify(sheet),
    });
    server.addMessage(chat.id, 'assistant', 'Die Tabelle steht bereit.', {
      artifacts: [{ id: 't1', kind: 'sheet', title: sheet.title, version: 1 }],
    });
    open(server, chatPath(subject.id, chat.id));
    expect(await screen.findByRole('button', { name: 'Als Excel herunterladen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Als CSV herunterladen' })).toBeTruthy();
    expect(screen.getByText('Beispiel A')).toBeTruthy();
  });

  it('bietet beim Dokument auch Word an', async () => {
    const { server, subject, chat } = setup();
    server.artifacts.set('d2', {
      id: 'd2',
      kind: 'document',
      title: DOCUMENT.title,
      version: 1,
      spec: JSON.stringify(DOCUMENT),
    });
    server.addMessage(chat.id, 'assistant', 'Hier.', {
      artifacts: [{ id: 'd2', kind: 'document', title: DOCUMENT.title, version: 1 }],
    });
    open(server, chatPath(subject.id, chat.id));
    expect(await screen.findByRole('button', { name: 'Als Word herunterladen' })).toBeTruthy();
  });

  it('zeigt eine einzelne Abbildung mit PNG- und SVG-Knopf', async () => {
    const { server, subject, chat } = setup();
    const figure = {
      title: 'Beispiel-Parabel',
      figure: { type: 'graph', graph: { functions: ['x^2'], x: [-2, 2] }, caption: 'Parabel' },
    };
    server.artifacts.set('f1', {
      id: 'f1',
      kind: 'figure',
      title: figure.title,
      version: 1,
      spec: JSON.stringify(figure),
    });
    server.addMessage(chat.id, 'assistant', 'Die Abbildung steht bereit.', {
      artifacts: [{ id: 'f1', kind: 'figure', title: figure.title, version: 1 }],
    });
    open(server, chatPath(subject.id, chat.id));
    expect(await screen.findByRole('button', { name: 'Als PNG herunterladen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Als SVG herunterladen' })).toBeTruthy();
    expect(screen.getByText('Parabel')).toBeTruthy();
  });

  it('meldet, wenn die Datei nicht geladen werden kann', async () => {
    const { server, subject, chat } = setup();
    server.addMessage(chat.id, 'assistant', 'Hier ist die Datei.', {
      artifacts: [{ id: 'fehlt', kind: 'document', title: 'Weg', version: 1 }],
    });
    open(server, chatPath(subject.id, chat.id));
    await waitFor(() =>
      expect(screen.getByText('Die Datei konnte nicht geladen werden.')).toBeTruthy(),
    );
  });

  it('hat in den Einstellungen einen eigenen Schalter für Dateien', async () => {
    const { server } = setup();
    open(server, '/settings');
    const user = userEvent.setup();
    const box = (await screen.findByRole('checkbox', {
      name: /KI darf Dateien erstellen/,
    })) as HTMLInputElement;
    expect(box.checked).toBe(true);
    await user.click(box);
    await waitFor(() => expect(server.filesEnabled).toBe(false));
    expect(server.calls('PUT', '/api/tool-settings')[0]?.body).toEqual({ files: false });
    expect(server.toolsEnabled).toBe(true);
  });
});
