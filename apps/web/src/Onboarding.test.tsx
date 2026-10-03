// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer, json } from './test/fake-server';

function fresh(): FakeServer {
  const server = new FakeServer('unlocked');
  server.profile.onboardingCompleted = false;
  return server;
}

function mount(server: FakeServer) {
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

async function toSubjectsStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Überspringen' }));
  await screen.findByRole('heading', { name: 'Deine Fächer' });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('Onboarding', () => {
  it('startet bei einer frischen Installation mit dem Profil und nennt den Fortschritt', async () => {
    mount(fresh());
    expect(await screen.findByRole('heading', { name: 'Dein Profil' })).toBeTruthy();
    expect(screen.getByText('Schritt 1 von 4')).toBeTruthy();
    // Nichts ist vorbelegt.
    for (const label of ['Bundesland oder Region', 'Schulform', 'Jahrgangsstufe']) {
      expect((screen.getByLabelText(new RegExp(label)) as HTMLInputElement).value).toBe('');
    }
  });

  it('überspringt das Profil, ohne etwas zu speichern', async () => {
    const server = fresh();
    mount(server);
    await toSubjectsStep(userEvent.setup());
    expect(server.calls('PATCH', '/api/profile')).toHaveLength(0);
  });

  it('speichert Profilangaben beim Weiter', async () => {
    const server = fresh();
    mount(server);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Bundesland/), 'Beispielland');
    await user.type(screen.getByLabelText(/Jahrgangsstufe/), '99');
    await user.click(screen.getByRole('button', { name: 'Weiter' }));

    await screen.findByRole('heading', { name: 'Deine Fächer' });
    expect(server.calls('PATCH', '/api/profile')[0]?.body).toEqual({
      federalState: 'Beispielland',
      schoolType: '',
      gradeLevel: '99',
    });
  });

  it('legt Fächer aus ausgewählten Vorlagen an und sperrt vorhandene', async () => {
    const server = fresh();
    server.addSubject('Beispielfach A');
    mount(server);
    const user = userEvent.setup();
    await toSubjectsStep(user);

    const existing = await screen.findByLabelText(/Beispielfach A/, { selector: 'input' });
    expect((existing as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('schon angelegt')).toBeTruthy();

    const submit = screen.getByRole('button', { name: 'Ausgewählte anlegen' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.click(screen.getByLabelText('Beispielfach B'));
    await user.click(submit);

    const created = screen.getByRole('region', { name: 'Angelegt' });
    expect(await within(created).findByText('Beispielfach B')).toBeTruthy();
    expect(server.subjects.map((s) => s.name)).toEqual(['Beispielfach A', 'Beispielfach B']);
    const sent = server.calls('POST', '/api/subjects/import')[0]?.body as
      | { content: string }
      | undefined;
    expect(JSON.parse(sent?.content ?? 'null')).toEqual({
      version: 1,
      subjects: [{ name: 'Beispielfach B' }],
    });
  });

  it('legt Fächer von Hand an und meldet doppelte Namen', async () => {
    const server = fresh();
    mount(server);
    const user = userEvent.setup();
    await toSubjectsStep(user);
    await user.click(screen.getByLabelText('Manuell'));

    await user.type(screen.getByLabelText('Name des Fachs'), 'Beispielfach C{Enter}');
    const created = screen.getByRole('region', { name: 'Angelegt' });
    expect(await within(created).findByText('Beispielfach C')).toBeTruthy();
    expect((screen.getByLabelText('Name des Fachs') as HTMLInputElement).value).toBe('');

    await user.type(screen.getByLabelText('Name des Fachs'), 'beispielfach c{Enter}');
    expect(await screen.findByText('Ein Fach mit diesem Namen gibt es schon.')).toBeTruthy();
  });

  it('importiert eine JSON-Datei und zeigt das Ergebnis', async () => {
    const server = fresh();
    server.addSubject('Beispielfach A');
    mount(server);
    const user = userEvent.setup();
    await toSubjectsStep(user);
    await user.click(screen.getByLabelText('Import'));

    const content = JSON.stringify({
      version: 1,
      subjects: [
        { name: 'Beispielfach A' },
        { name: 'Beispielfach D', teacher: 'Beispiel-Lehrkraft' },
        {},
      ],
    });
    await user.upload(
      screen.getByLabelText('Datei wählen'),
      new File([content], 'faecher.json', { type: 'application/json' }),
    );

    expect(
      await screen.findByText('1 angelegt, 1 übersprungen (gab es schon), 1 ungültig.'),
    ).toBeTruthy();
    expect(server.calls('POST', '/api/subjects/import')[0]?.body).toEqual({
      format: 'json',
      content,
    });
    const created = screen.getByRole('region', { name: 'Angelegt' });
    expect(within(created).getByText('Beispielfach D')).toBeTruthy();
  });

  it('erkennt CSV an der Endung', async () => {
    const server = fresh();
    mount(server);
    const user = userEvent.setup();
    await toSubjectsStep(user);
    await user.click(screen.getByLabelText('Import'));
    await user.upload(
      screen.getByLabelText('Datei wählen'),
      new File(['name\nBeispielfach E\n'], 'faecher.csv', { type: 'text/csv' }),
    );
    await waitFor(() =>
      expect(server.calls('POST', '/api/subjects/import')[0]?.body).toMatchObject({
        format: 'csv',
      }),
    );
  });

  it('weist falsche Endungen und zu große Dateien ab, ohne sie zu senden', async () => {
    const server = fresh();
    mount(server);
    const user = userEvent.setup({ applyAccept: false });
    await toSubjectsStep(user);
    await user.click(screen.getByLabelText('Import'));
    const input = screen.getByLabelText('Datei wählen');

    await user.upload(input, new File(['x'], 'faecher.txt', { type: 'text/plain' }));
    expect(
      await screen.findByText('Bitte wähle eine Datei mit der Endung .json oder .csv.'),
    ).toBeTruthy();

    await user.upload(input, new File(['x'.repeat(256 * 1024 + 1)], 'gross.json'));
    expect(await screen.findByText('Die Datei ist zu groß (höchstens 256 KiB).')).toBeTruthy();
    expect(server.calls('POST', '/api/subjects/import')).toHaveLength(0);
  });

  it('übersetzt Fehler des Servers beim Import', async () => {
    const server = fresh();
    mount(server);
    const user = userEvent.setup();
    await toSubjectsStep(user);
    await user.click(screen.getByLabelText('Import'));
    await user.upload(
      screen.getByLabelText('Datei wählen'),
      new File(['das ist kein JSON'], 'faecher.json'),
    );
    expect(await screen.findByText(/nicht das erwartete Format/)).toBeTruthy();
  });

  it('entfernt ein angelegtes Fach wieder', async () => {
    const server = fresh();
    server.addSubject('Beispielfach A');
    mount(server);
    const user = userEvent.setup();
    await toSubjectsStep(user);
    await user.click(await screen.findByRole('button', { name: '„Beispielfach A“ entfernen' }));
    await waitFor(() => expect(server.subjects).toEqual([]));
    expect(await screen.findByText('Noch nichts angelegt.')).toBeTruthy();
  });

  it('führt über den Anbieter bis zum Datenschutz, geht zurück und schließt ab', async () => {
    const server = fresh();
    mount(server);
    const user = userEvent.setup();
    await toSubjectsStep(user);

    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(await screen.findByRole('heading', { name: 'Dein Modell-Anbieter' })).toBeTruthy();
    expect(screen.getByText('Schritt 3 von 4')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Überspringen' }));
    expect(await screen.findByRole('heading', { name: 'Datenschutz' })).toBeTruthy();
    expect(screen.getByText('Schritt 4 von 4')).toBeTruthy();
    expect(screen.getByText(/Pagewise sammelt nichts/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Zurück' }));
    expect(await screen.findByRole('heading', { name: 'Dein Modell-Anbieter' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Überspringen' }));

    await user.click(await screen.findByRole('button', { name: 'Los geht’s' }));
    expect(await screen.findByRole('heading', { name: 'Noch keine Fächer' })).toBeTruthy();
    expect(server.profile.onboardingCompleted).toBe(true);
    expect(server.providers).toEqual([]);
    expect(screen.queryByText('Schritt 4 von 4')).toBeNull();
  });

  it('zeigt nach dem Abschluss beim nächsten Start gleich die App', async () => {
    const server = fresh();
    server.profile.onboardingCompleted = true;
    mount(server);
    expect(await screen.findByRole('heading', { name: 'Noch keine Fächer' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Dein Profil' })).toBeNull();
  });
});

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const KEY = ['beispiel', 'schluessel', 'abcdefghijklmnop'].join('-');

async function toProviderStep(user: ReturnType<typeof userEvent.setup>) {
  await toSubjectsStep(user);
  await user.click(screen.getByRole('button', { name: 'Weiter' }));
  await screen.findByRole('heading', { name: 'Dein Modell-Anbieter' });
  // Die Voreinstellungen kommen vom Server, erst danach gibt es das Formular.
  await screen.findByLabelText(/API-Schlüssel/);
}

describe('Onboarding: Schritt „Anbieter“', () => {
  it('wählt OpenRouter vor und verlangt dafür einen Schlüssel', async () => {
    const server = fresh();
    mount(server);
    const user = userEvent.setup();
    await toProviderStep(user);

    expect((screen.getByRole('radio', { name: /^OpenRouter/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('OpenRouter');
    expect((screen.getByLabelText(/Adresse/) as HTMLInputElement).value).toBe(
      'https://openrouter.ai/api/v1',
    );

    await user.click(screen.getByRole('button', { name: 'Anlegen und testen' }));
    expect(await screen.findByText('Dieser Anbieter braucht einen Schlüssel.')).toBeTruthy();
    expect(server.calls('POST', '/api/providers')).toHaveLength(0);
    // Ohne Anbieter bleibt nur das Überspringen.
    expect(screen.queryByRole('button', { name: 'Weiter' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Überspringen' })).toBeTruthy();
  });

  it('legt den Anbieter an, testet ihn und zeigt den Schlüssel nie', async () => {
    const server = fresh();
    mount(server);
    const user = userEvent.setup();
    await toProviderStep(user);

    await user.type(screen.getByLabelText(/API-Schlüssel/), KEY);
    await user.click(screen.getByRole('button', { name: 'Anlegen und testen' }));

    expect(await screen.findByText('„OpenRouter“ ist angelegt.')).toBeTruthy();
    expect(await screen.findByText('Verbindung steht (42 ms).')).toBeTruthy();
    expect(server.calls('POST', '/api/providers')[0]?.body).toMatchObject({
      name: 'OpenRouter',
      preset: 'openrouter',
      apiKey: KEY,
    });
    expect(server.calls('POST', `/api/providers/${server.providers[0]?.id}/test`)).toHaveLength(1);
    expect(document.body.innerHTML).not.toContain(KEY);

    // Das Formular ist weg, weiter geht es zum Datenschutz.
    expect(screen.queryByLabelText(/API-Schlüssel/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(await screen.findByRole('heading', { name: 'Datenschutz' })).toBeTruthy();
  });

  it('meldet einen abgelehnten Schlüssel und testet auf Wunsch erneut', async () => {
    const server = fresh();
    server.testOutcome = { ok: false, code: 'auth_failed' };
    mount(server);
    const user = userEvent.setup();
    await toProviderStep(user);

    await user.type(screen.getByLabelText(/API-Schlüssel/), KEY);
    await user.click(screen.getByRole('button', { name: 'Anlegen und testen' }));
    expect(await screen.findByText('Der Anbieter lehnt den Schlüssel ab.')).toBeTruthy();
    // Angelegt ist er trotzdem, der Test ist nur eine Auskunft.
    expect(screen.getByText('„OpenRouter“ ist angelegt.')).toBeTruthy();

    server.testOutcome = { ok: true, latencyMs: 7, modelCount: 3 };
    await user.click(screen.getByRole('button', { name: 'Erneut testen' }));
    expect(await screen.findByText('Verbindung steht (7 ms), 3 Modelle verfügbar.')).toBeTruthy();
    expect(screen.queryByText('Der Anbieter lehnt den Schlüssel ab.')).toBeNull();
    expect(server.calls('POST', `/api/providers/${server.providers[0]?.id}/test`)).toHaveLength(2);
  });

  it('legt einen lokalen Anbieter ohne Schlüssel an', async () => {
    const server = fresh();
    mount(server);
    const user = userEvent.setup();
    await toProviderStep(user);

    await user.click(screen.getByRole('radio', { name: /^Ollama/ }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Ollama (lokal)');
    expect((screen.getByLabelText(/Adresse/) as HTMLInputElement).value).toBe(
      'http://localhost:11434/v1',
    );
    await user.click(screen.getByRole('button', { name: 'Anlegen und testen' }));

    expect(await screen.findByText('„Ollama (lokal)“ ist angelegt.')).toBeTruthy();
    const body = server.calls('POST', '/api/providers')[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ preset: 'ollama' });
    expect('apiKey' in body).toBe(false);
  });

  it('nimmt beim Wechsel der Voreinstellung keinen Schlüssel mit', async () => {
    const server = fresh();
    mount(server);
    const user = userEvent.setup();
    await toProviderStep(user);

    await user.type(screen.getByLabelText(/API-Schlüssel/), KEY);
    await user.click(screen.getByRole('radio', { name: /^Eigener Anbieter/ }));
    expect((screen.getByLabelText(/API-Schlüssel/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/Adresse/) as HTMLInputElement).value).toBe('');
  });

  it('zeigt Fehler des Servers am Feld und legt nichts an', async () => {
    const server = fresh();
    mount(server);
    const user = userEvent.setup();
    await toProviderStep(user);

    await user.click(screen.getByRole('radio', { name: /^Eigener Anbieter/ }));
    await user.type(screen.getByLabelText(/Adresse/), 'http://anbieter.example.test/v1');
    await user.click(screen.getByRole('button', { name: 'Anlegen und testen' }));
    expect(await screen.findByText(/^Die Adresse muss mit https:\/\/ beginnen/)).toBeTruthy();
    expect(server.providers).toEqual([]);
    expect(screen.queryByText(/ist angelegt/)).toBeNull();
  });

  it('übernimmt eine Änderung aus dem Bearbeiten-Dialog in die Anzeige', async () => {
    const server = fresh();
    mount(server);
    const user = userEvent.setup();
    await toProviderStep(user);

    await user.type(screen.getByLabelText(/API-Schlüssel/), KEY);
    await user.click(screen.getByRole('button', { name: 'Anlegen und testen' }));
    await screen.findByText('„OpenRouter“ ist angelegt.');

    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Anbieter bearbeiten' });
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Mein Zugang');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByText('„Mein Zugang“ ist angelegt.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.providers.map((p) => p.name)).toEqual(['Mein Zugang']);
  });

  it('meldet, wenn die Voreinstellungen nicht geladen werden können', async () => {
    const server = fresh();
    server.replyOnce('GET', '/api/provider-presets', () => json(500, { error: 'internal' }));
    mount(server);
    const user = userEvent.setup();
    await toSubjectsStep(user);
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    await screen.findByRole('heading', { name: 'Dein Modell-Anbieter' });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Anlegen und testen' })).toBeNull();
    // Überspringen geht immer.
    await user.click(screen.getByRole('button', { name: 'Überspringen' }));
    expect(await screen.findByRole('heading', { name: 'Datenschutz' })).toBeTruthy();
  });
});
