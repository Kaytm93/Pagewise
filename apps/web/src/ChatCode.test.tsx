// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import type { CodeOutcome } from './api/types';
import { FakeServer } from './test/fake-server';

function open(server: FakeServer, path: string) {
  window.history.replaceState(null, '', path);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}
const chatPath = (subjectId: string, chatId: string) => `/subjects/${subjectId}/chats/${chatId}`;

beforeAll(async () => {
  await import('./screens/chat/ChatPage');
}, 30_000);
beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('Einstellungen: Code ausführen', () => {
  it('ist standardmäßig aus und schaltet erst nach der Erklärung ein', async () => {
    const server = new FakeServer('unlocked');
    open(server, '/settings');
    const user = userEvent.setup();
    const box = (await screen.findByRole('checkbox', {
      name: /KI darf Code ausführen/,
    })) as HTMLInputElement;
    expect(box.checked).toBe(false);

    await user.click(box);
    const dialog = await screen.findByRole('dialog', { name: 'Code-Ausführung einschalten?' });
    // Die Erklärung nennt, was passiert und was gesperrt ist.
    expect(within(dialog).getByText(/ohne Netz, ohne Zugriff auf deine Dateien/)).toBeTruthy();
    expect(within(dialog).getByText(/60 Sekunden, 1 GB Speicher/)).toBeTruthy();
    // Bis zur Bestätigung ist nichts gespeichert.
    expect(server.codeEnabled).toBe(false);
    expect(server.calls('PUT', '/api/tool-settings')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Verstanden, einschalten' }));
    await waitFor(() => expect(server.codeEnabled).toBe(true));
    expect(server.calls('PUT', '/api/tool-settings')[0]?.body).toEqual({
      code: true,
      confirm: true,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('bricht ohne Folgen ab', async () => {
    const server = new FakeServer('unlocked');
    open(server, '/settings');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: /KI darf Code ausführen/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Code-Ausführung einschalten?' });
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(server.codeEnabled).toBe(false);
    expect(server.calls('PUT', '/api/tool-settings')).toHaveLength(0);
  });

  it('schaltet ohne Rückfrage wieder aus', async () => {
    const server = new FakeServer('unlocked');
    server.codeEnabled = true;
    open(server, '/settings');
    const user = userEvent.setup();
    const box = (await screen.findByRole('checkbox', {
      name: /KI darf Code ausführen/,
    })) as HTMLInputElement;
    expect(box.checked).toBe(true);
    await user.click(box);
    await waitFor(() => expect(server.codeEnabled).toBe(false));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('richtet Python nur nach Erklärung und Klick ein und zeigt den Fortschritt', async () => {
    const server = new FakeServer('unlocked');
    open(server, '/settings');
    const user = userEvent.setup();
    expect(await screen.findByText('Python ist noch nicht eingerichtet.')).toBeTruthy();
    // Nichts wird ohne Klick gestartet.
    expect(server.calls('POST', '/api/code/setup')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Python einrichten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Python einrichten?' });
    expect(within(dialog).getByText(/ändert nichts am Rest deines Rechners/)).toBeTruthy();
    expect(server.calls('POST', '/api/code/setup')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Einrichten' }));
    await waitFor(() => expect(server.calls('POST', '/api/code/setup')).toHaveLength(1));
    expect(server.calls('POST', '/api/code/setup')[0]?.body).toEqual({ confirm: true });
    expect(await screen.findByText(/Python wird geladen/)).toBeTruthy();
    expect(screen.getByText(/20 %/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Einrichtung abbrechen' })).toBeTruthy();
  });

  it('zeigt einen Fehler der Einrichtung als Text, nie die Ausgabe', async () => {
    const server = new FakeServer('unlocked');
    server.codeStatus.setup = {
      state: 'error',
      phase: null,
      progress: null,
      error: 'checksum_mismatch',
    };
    open(server, '/settings');
    expect(await screen.findByText(/Die Prüfsumme der Datei stimmt nicht/)).toBeTruthy();
  });

  it('meldet, wenn die Sandbox den Selbsttest nicht besteht', async () => {
    const server = new FakeServer('unlocked');
    server.codeStatus.runtime = 'ready';
    server.codeStatus.ready = false;
    open(server, '/settings');
    expect(await screen.findByText(/Sandbox hat den Selbsttest nicht bestanden/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Python entfernen' })).toBeTruthy();
  });

  it('zeigt bei veraltetem Python ein Banner mit Neu-einrichten und hält die Zeile bereit', async () => {
    const server = new FakeServer('unlocked');
    // Wie routes/code.test.ts (7122d0e): fremder Lock-Sha führt zu runtime „outdated“.
    server.codeStatus.runtime = 'outdated';
    server.codeStatus.ready = false;
    open(server, '/settings');
    // Auffälliges Banner mit Handlungsaufruf (D-103-Folge), Text nur aus i18n.
    const banner = await screen.findByTestId('code-outdated-banner');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('Python-Pakete veraltet — neu einrichten');
    expect(within(banner).getByRole('button', { name: 'Neu einrichten' })).toBeTruthy();
    // Die gewohnte Statuszeile bleibt daneben stehen.
    expect(
      screen.getByText('Die eingerichtete Fassung ist veraltet. Richte Python neu ein.'),
    ).toBeTruthy();
  });

  it('zeigt bei eingerichtetem Python kein Banner', async () => {
    const server = new FakeServer('unlocked');
    server.codeStatus.runtime = 'ready';
    server.codeStatus.ready = true;
    open(server, '/settings');
    expect(await screen.findByText(/Python ist eingerichtet, und die Sandbox sperrt/)).toBeTruthy();
    expect(screen.queryByTestId('code-outdated-banner')).toBeNull();
  });

  it('zeigt bei fehlendem Python den Einrichten-Knopf ohne Banner', async () => {
    const server = new FakeServer('unlocked');
    open(server, '/settings');
    expect(await screen.findByText('Python ist noch nicht eingerichtet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Python einrichten' })).toBeTruthy();
    expect(screen.queryByTestId('code-outdated-banner')).toBeNull();
  });

  it('nennt, was für die Sichtprüfung fehlt', async () => {
    const server = new FakeServer('unlocked');
    server.codeStatus.preview = { office: false, raster: true, sandbox: true };
    open(server, '/settings');
    expect(await screen.findByText(/Nicht möglich, es fehlt: LibreOffice\./)).toBeTruthy();
    expect(screen.getByText(/brew install --cask libreoffice/)).toBeTruthy();
  });

  it('meldet, wenn die Sichtprüfung möglich ist', async () => {
    const server = new FakeServer('unlocked');
    server.codeStatus.preview = { office: true, raster: true, sandbox: true };
    open(server, '/settings');
    expect(await screen.findByText(/Die Seitenbilder gehen nur an dieses Modell/)).toBeTruthy();
  });

  it('bietet auf anderen Systemen nichts an', async () => {
    const server = new FakeServer('unlocked');
    server.codeStatus.supported = false;
    open(server, '/settings');
    expect(await screen.findByText(/gibt es nur dort/)).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /KI darf Code ausführen/ })).toBeNull();
  });
});

describe('Anbieter: Code ausführen lassen', () => {
  it('ist standardmäßig aus und lässt sich je Anbieter freigeben', async () => {
    const server = new FakeServer('unlocked');
    const provider = server.addProvider('Anbieter A', { hasKey: true });
    open(server, '/settings');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '„Anbieter A“ bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Anbieter bearbeiten' });
    const box = within(dialog).getByRole('checkbox', {
      name: /Code ausführen lassen/,
    }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await user.click(box);
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(server.calls('PATCH', `/api/providers/${provider.id}`)).toHaveLength(1),
    );
    expect(server.calls('PATCH', `/api/providers/${provider.id}`)[0]?.body).toEqual({
      allowCode: true,
    });
  });
});

describe('Chat: Code, den das Modell ausgeführt hat', () => {
  function setup() {
    const server = new FakeServer('unlocked');
    const subject = server.addSubject('Beispiel-Physik');
    const chat = server.addChat(subject.id);
    server.addMessage(chat.id, 'user', 'Mach mir ein Diagramm.');
    return { server, subject, chat };
  }

  it('zeigt, dass Code lief, wie er ausging und welche Dateien entstanden sind', async () => {
    const { server, subject, chat } = setup();
    server.addMessage(chat.id, 'assistant', 'Das Diagramm steht bereit.', {
      codeRuns: [
        {
          id: 'lauf-1',
          purpose: 'Diagramm zeichnen',
          outcome: 'ok',
          durationMs: 2400,
          files: ['diagramm.png'],
        },
        { id: 'lauf-2', purpose: null, outcome: 'timeout', durationMs: 60000, files: [] },
      ],
    });
    open(server, chatPath(subject.id, chat.id));
    expect(await screen.findByText('Das Diagramm steht bereit.')).toBeTruthy();
    const list = within(await screen.findByRole('list', { name: 'Code dieser Antwort' }));
    expect(list.getByText('Code ausgeführt: Diagramm zeichnen')).toBeTruthy();
    expect(list.getByText('Erfolgreich')).toBeTruthy();
    expect(list.getByText('2,4 s')).toBeTruthy();
    expect(list.getByText('Zeitlimit erreicht')).toBeTruthy();
    expect(list.getByText('1:00 min')).toBeTruthy();
    // Ausgaben-Inhalte gibt es weiterhin nicht; der Lauf ohne Dateien bleibt gemeldet.
    expect(list.getByText('Keine neue Datei')).toBeTruthy();
    // Das Skript wird nicht ungefragt geladen.
    expect(server.calls('GET', '/api/code-runs/lauf-1')).toHaveLength(0);
  });

  it('zeigt je festem Ausgangscode Text und Symbol', async () => {
    const codes: [CodeOutcome, string, string][] = [
      ['ok', 'Erfolgreich', 'lucide-circle-check'],
      ['error', 'Mit Fehler beendet', 'lucide-circle-x'],
      ['timeout', 'Zeitlimit erreicht', 'lucide-clock-alert'],
      ['cancelled', 'Abgebrochen', 'lucide-ban'],
      ['output_limit', 'Zu viel Ausgabe', 'lucide-hourglass'],
      ['memory_limit', 'Zu viel Speicher', 'lucide-hourglass'],
      ['disk_limit', 'Zu viele oder zu große Dateien', 'lucide-hourglass'],
      ['unavailable', 'Nicht verfügbar', 'lucide-circle-alert'],
      ['failed', 'Nicht gestartet', 'lucide-circle-alert'],
    ];
    for (const [code, text, icon] of codes) {
      const { server, subject, chat } = setup();
      server.addMessage(chat.id, 'assistant', 'Fertig.', {
        codeRuns: [{ id: 'lauf', purpose: null, outcome: code, durationMs: 100, files: [] }],
      });
      open(server, chatPath(subject.id, chat.id));
      const list = await screen.findByRole('list', { name: 'Code dieser Antwort' });
      expect(within(list).getByText(text)).toBeTruthy();
      // Der feste Code hat sein Zeichen (lucide-SVG mit seinem Namen als Klasse).
      expect(list.querySelector(`svg.${icon}`)).toBeTruthy();
      cleanup();
    }
  });

  it('lädt das Skript erst auf Klick und zeigt es nur als Text', async () => {
    const { server, subject, chat } = setup();
    const script = 'import os\nprint("<img src=x onerror=alert(1)>")';
    server.codeRuns.set('lauf-1', {
      id: 'lauf-1',
      purpose: 'Test',
      outcome: 'ok',
      durationMs: 100,
      files: [],
      script,
    });
    server.addMessage(chat.id, 'assistant', 'Fertig.', {
      codeRuns: [{ id: 'lauf-1', purpose: 'Test', outcome: 'ok', durationMs: 100, files: [] }],
    });
    const { container } = open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    // Eingeklappt wie in der Oberfläche (details/summary); gefunden wie in AgentActivity.test.tsx.
    const summary = (await screen.findByText('Code anzeigen')).closest('summary');
    if (!summary) throw new Error('Kein summary gerendert');
    const details = summary.closest('details');
    if (!details) throw new Error('Kein details gerendert');
    expect(details.open).toBe(false);
    expect(server.calls('GET', '/api/code-runs/lauf-1')).toHaveLength(0);
    expect(container.querySelector('img')).toBeNull();
    await user.click(summary);
    await waitFor(() => expect(server.calls('GET', '/api/code-runs/lauf-1')).toHaveLength(1));
    expect(details.open).toBe(true);
    const code = await screen.findByText(/print\("<img src=x onerror=alert\(1\)>"\)/);
    expect(code.tagName).toBe('CODE');
    // Kein Markup aus dem Skript entsteht in der Seite.
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/Dieses Programm hat das Modell geschrieben/)).toBeTruthy();
    expect(screen.getByText('Code ausblenden')).toBeTruthy();
    // Wieder zugeklappt: das Skript bleibt geladen, es gibt keine zweite Anfrage.
    const hideSummary = await screen
      .findByText('Code ausblenden')
      .then((e) => e.closest('summary'));
    if (!hideSummary) throw new Error('Kein summary gerendert');
    await user.click(hideSummary);
    expect(details.open).toBe(false);
    await waitFor(() => expect(screen.getByText('Code anzeigen')).toBeTruthy());
    expect(server.calls('GET', '/api/code-runs/lauf-1')).toHaveLength(1);
  });

  it('zeigt erzeugte Dateien als Raster mit Name und Art-Symbol', async () => {
    const { server, subject, chat } = setup();
    server.addMessage(chat.id, 'assistant', 'Vier Dateien sind entstanden.', {
      codeRuns: [
        {
          id: 'lauf-1',
          purpose: 'Belege bauen',
          outcome: 'ok',
          durationMs: 1500,
          files: ['diagramm.png', 'noten.csv', 'bericht.md', 'archiv.zip'],
        },
      ],
    });
    open(server, chatPath(subject.id, chat.id));
    const grid = await screen.findByRole('list', { name: 'Erzeugte Dateien' });
    const items = within(grid).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    for (const name of ['diagramm.png', 'noten.csv', 'bericht.md', 'archiv.zip']) {
      const entry = within(grid).getByText(name);
      // Der volle Name steht als Titel am Rasterfeld (wie in der Dateiliste des Panels).
      expect(entry.closest('li')?.getAttribute('title')).toBe(name);
    }
    // Art-Symbole nach Endung, wie im Datei-Panel (H-C02): Bilder, Tabellen, Text, sonst allgemein.
    const icons = [...grid.querySelectorAll('svg')].map((icon) => icon.getAttribute('class') ?? '');
    expect(icons.some((name) => name.includes('lucide-file-image'))).toBe(true);
    expect(icons.some((name) => name.includes('lucide-file-spreadsheet'))).toBe(true);
    expect(icons.some((name) => name.includes('lucide-file-text'))).toBe(true);
    expect(icons.filter((name) => name.includes('lucide-file'))).toHaveLength(4);
    // Öffnen und Herunterladen bleibt beim Datei-Panel; hier gibt es keine Knöpfe.
    expect(within(grid).queryByRole('button')).toBeNull();
  });

  it('meldet, wenn das Skript nicht geladen werden kann', async () => {
    const { server, subject, chat } = setup();
    server.addMessage(chat.id, 'assistant', 'Fertig.', {
      codeRuns: [{ id: 'weg', purpose: null, outcome: 'error', durationMs: 100, files: [] }],
    });
    open(server, chatPath(subject.id, chat.id));
    const user = userEvent.setup();
    await user.click((await screen.findByText('Code anzeigen')).closest('summary') as Element);
    expect(await screen.findByText('Der Code konnte nicht geladen werden.')).toBeTruthy();
    expect(screen.getByText('Mit Fehler beendet')).toBeTruthy();
  });

  it('zeigt am Werkzeugaufruf nur den Zweck, nie das Skript', async () => {
    const { server, subject, chat } = setup();
    server.addMessage(chat.id, 'assistant', 'Fertig.', {
      activity: [
        { id: '0', tool: 'run_python', target: 'Diagramm zeichnen', file: null, state: 'done' },
      ],
    });
    open(server, chatPath(subject.id, chat.id));
    const notes = within(await screen.findByRole('list', { name: 'Abgefragte Daten' }));
    expect(notes.getByText('Code ausgeführt: Diagramm zeichnen')).toBeTruthy();
  });

  it('zeigt die Sichtprüfung als Hinweis an der Antwort', async () => {
    const { server, subject, chat } = setup();
    server.addMessage(chat.id, 'assistant', 'Fertig.', {
      activity: [
        { id: '0', tool: 'preview_file', target: 'folien.pptx', file: null, state: 'done' },
      ],
    });
    open(server, chatPath(subject.id, chat.id));
    const notes = within(await screen.findByRole('list', { name: 'Abgefragte Daten' }));
    expect(notes.getByText('Datei angesehen: folien.pptx')).toBeTruthy();
  });
});
