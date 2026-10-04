// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import type { EngineProfile } from './api/types';
import { FakeServer } from './test/fake-server';

const MODEL = { id: 'modell-a', vision: false, tools: false, reasoning: false, streaming: true };

function setup(options: { apiModel?: boolean; kind?: EngineProfile['kind'] } = {}) {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach A');
  const provider = server.addProvider('Anbieter A', {
    models: [{ ...MODEL, free: false }],
    hasKey: true,
  });
  if (options.apiModel !== false) {
    server.modelSettings = {
      default: { providerId: provider.id, model: 'modell-a' },
      fallback: [],
    };
  }
  const engine = server.addEngine('Mein Zugang', { kind: options.kind ?? 'glm-coding-plan' });
  const chat = server.addChat(subject.id, { engineProfileId: engine.id });
  return { server, subject, provider, engine, chat };
}

function open(server: FakeServer, path: string) {
  window.history.replaceState(null, '', path);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

const chatPath = (subjectId: string, chatId: string) => `/subjects/${subjectId}/chats/${chatId}`;

async function ask(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(await screen.findByRole('textbox', { name: 'Nachricht' }));
  await user.paste(text);
  await user.click(screen.getByRole('button', { name: 'Senden' }));
}

beforeAll(async () => {
  await import('./screens/chat/ChatPage');
}, 30_000);

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('Chat mit Agent: Auswahl', () => {
  it('zeigt im Chat den Agent-Zugang und lässt ihn im Dialog wählen oder abwählen', async () => {
    const { server, subject, engine } = setup();
    const chat = server.addChat(subject.id);
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();

    const chip = await screen.findByRole('button', { name: 'Modell wählen' });
    expect(chip.textContent).toContain('Anbieter A · modell-a');
    await user.click(chip);
    const dialog = await screen.findByRole('dialog', { name: 'Modell für diesen Chat' });
    const select = within(dialog).getByLabelText('Modell');
    // Agenten und Modelle stehen in getrennten Gruppen.
    expect(within(dialog).getByRole('group', { name: 'Agenten (Claude Code)' })).toBeTruthy();
    expect(within(dialog).getByRole('group', { name: 'Modelle von Anbietern' })).toBeTruthy();
    await user.selectOptions(select, `engine:${engine.id}`);
    expect(within(dialog).getByText(/arbeitet in einem eigenen Ordner/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Modell wählen' }).textContent).toContain(
        'Agent: Mein Zugang',
      ),
    );
    expect(server.calls('PATCH', `/api/chats/${chat.id}`)[0]?.body).toEqual({
      engineProfileId: engine.id,
    });

    // Zurück zu „wie im Fach“ hebt die Wahl auf.
    await user.click(screen.getByRole('button', { name: 'Modell wählen' }));
    const again = await screen.findByRole('dialog', { name: 'Modell für diesen Chat' });
    await user.selectOptions(within(again).getByLabelText('Modell'), '');
    await user.click(within(again).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Modell wählen' }).textContent).toContain(
        'Anbieter A · modell-a',
      ),
    );
  });

  it('wählt im Fach einen Agent-Zugang und zeigt ihn an', async () => {
    const { server, subject, engine } = setup();
    open(server, `/subjects/${subject.id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Modell ändern' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modell für dieses Fach' });
    await user.selectOptions(within(dialog).getByLabelText('Modell'), `engine:${engine.id}`);
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Agent: Mein Zugang')).toBeTruthy();
    expect(server.calls('PUT', `/api/subjects/${subject.id}/engine`)[0]?.body).toEqual({
      engineProfileId: engine.id,
    });
  });

  it('bietet Agenten auch an, wenn noch kein Modell eingerichtet ist', async () => {
    const { server, subject } = setup({ apiModel: false });
    // Ein Chat ohne eigene Wahl: ohne Modell und ohne Zugang gibt es keine Antwort.
    const chat = server.addChat(subject.id);
    open(server, chatPath(subject.id, chat.id));
    expect(await screen.findByText('Noch kein Modell gewählt')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Modell wählen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modell für diesen Chat' });
    expect(within(dialog).queryByText(/Es ist noch kein Modell eingerichtet/)).toBeNull();
    expect(within(dialog).getByRole('option', { name: 'Mein Zugang' })).toBeTruthy();
  });
});

describe('Chat mit Agent: Antwort', () => {
  it('zeigt die Schritte des Agenten live, danach eingeklappt, und die erzeugte Datei als Download', async () => {
    const { server, subject, chat } = setup();
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    expect((await screen.findByRole('button', { name: 'Modell wählen' })).textContent).toContain(
      'Agent: Mein Zugang',
    );
    await ask(user, 'Erstelle eine Übersicht');
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    expect(await screen.findByText('Der Agent arbeitet …')).toBeTruthy();

    const generation = server.generation(chat.id);
    act(() =>
      generation.activity({ id: 't1', tool: 'Write', target: 'uebersicht.pdf', state: 'running' }),
    );
    expect(await screen.findByText('Der Agent arbeitet: uebersicht.pdf')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Schritte des Agenten' })).toBeTruthy();
    act(() =>
      generation.activity({ id: 't1', tool: 'Write', target: 'uebersicht.pdf', state: 'done' }),
    );
    act(() => {
      generation.delta('Die Übersicht ist fertig.');
      generation.finish({
        engineProfileId: chat.engineProfileId,
        model: 'glm-5.3-flash',
        assets: [
          {
            id: 'asset-1',
            name: 'uebersicht.pdf',
            kind: 'pdf',
            mime: 'application/pdf',
            size: 48_000,
          },
        ],
      });
    });

    expect(await screen.findByText('Die Übersicht ist fertig.')).toBeTruthy();
    const link = await screen.findByRole('link', {
      name: 'uebersicht.pdf herunterladen (46,9 KB)',
    });
    expect(link.getAttribute('href')).toBe('/api/assets/asset-1/download');
    expect(link.hasAttribute('download')).toBe(true);
    // Nach dem Ende sind die Schritte eingeklappt.
    const summary = screen.getByText('Was der Agent getan hat (1)');
    expect(summary.closest('details')?.open).toBe(false);
    await user.click(summary);
    expect(
      within(screen.getByRole('list', { name: 'Schritte des Agenten' })).getByText(
        'Geschrieben: uebersicht.pdf',
      ),
    ).toBeTruthy();
  });

  it('übernimmt Schritte und Dateien auch beim Wiederanhängen und beim Laden des Verlaufs', async () => {
    const { server, subject, chat } = setup();
    server.addMessage(chat.id, 'user', 'Frage');
    server.addMessage(chat.id, 'assistant', 'Antwort mit Datei', {
      engineProfileId: chat.engineProfileId,
      activity: [{ id: '0', tool: 'Bash', target: 'Tabelle berechnen', state: 'error' }],
      assets: [{ id: 'asset-2', name: 'tabelle.xlsx', kind: 'xlsx', mime: 'x', size: 200 }],
    });
    open(server, chatPath(subject.id, chat.id));
    expect(await screen.findByText('Antwort mit Datei')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'tabelle.xlsx herunterladen (200 B)' })).toBeTruthy();
    await userEvent.setup().click(screen.getByText('Was der Agent getan hat (1)'));
    expect(screen.getByText('Befehl: Tabelle berechnen')).toBeTruthy();
    expect(screen.getByText('fehlgeschlagen')).toBeTruthy();
  });

  it('nennt Fehler nach der Art des Zugangs', async () => {
    const { server, subject, chat } = setup({ kind: 'claude-subscription' });
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    await ask(user, 'Hallo');
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    act(() => server.generation(chat.id).fail('auth_failed'));
    // Die Nachricht trägt den Zugang, daraus ergibt sich der Text.
    expect(await screen.findByText(/Claude Code ist nicht angemeldet/)).toBeTruthy();
  });

  it('erklärt „kein Paket“ bei einem Coding Plan anders als bei einem API-Anbieter', async () => {
    const { server, subject, chat } = setup();
    open(server, chatPath(subject.id, chat.id));
    await ask(userEvent.setup(), 'Hallo');
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    act(() => server.generation(chat.id).fail('no_package'));
    expect(await screen.findByText(/Prüfe, ob dein GLM Coding Plan aktiv ist/)).toBeTruthy();
    expect(screen.queryByText(/auf dieser Adresse nur Guthaben/)).toBeNull();
  });

  it.each([
    ['cli_missing', /„claude“ wurde auf diesem Rechner nicht gefunden/, true],
    ['sandbox_unavailable', /Schutzumgebung für den Agenten konnte nicht starten/, false],
    ['agent_limit', /Limit an Arbeitsschritten/, false],
    ['agent_timeout', /zu lange gebraucht/, false],
  ])('erklärt den Fehler %s', async (code, text, settingsLink) => {
    const { server, subject, chat } = setup();
    open(server, chatPath(subject.id, chat.id));
    await ask(userEvent.setup(), 'Hallo');
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    act(() => server.generation(chat.id).fail(code));
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Zu den Einstellungen' }) !== null).toBe(
      settingsLink,
    );
  });

  it('wiederholt nach einem Fehler des Agenten auf Wunsch mit einem API-Modell', async () => {
    const { server, subject, chat } = setup();
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    await ask(user, 'Hallo');
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    act(() => server.generation(chat.id).fail('agent_failed'));
    await user.click(await screen.findByRole('button', { name: 'Mit API-Modell erneut' }));
    expect(server.calls('POST', `/api/chats/${chat.id}/retry`)[0]?.body).toEqual({ viaApi: true });
    // Die neue Antwort kommt von einem Modell, nicht vom Agenten.
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    expect(server.generation(chat.id).assistant.engineProfileId).toBeNull();
  });

  it('bietet „Mit API-Modell erneut“ nicht an, wenn kein Modell eingerichtet ist', async () => {
    const { server, subject, chat } = setup({ apiModel: false });
    open(server, chatPath(subject.id, chat.id));
    await ask(userEvent.setup(), 'Hallo');
    await waitFor(() => expect(server.generations.has(chat.id)).toBe(true));
    act(() => server.generation(chat.id).fail('agent_failed'));
    expect(await screen.findByRole('button', { name: 'Erneut versuchen' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mit API-Modell erneut' })).toBeNull();
  });
});
