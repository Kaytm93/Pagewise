// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer } from './test/fake-server';

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
    expect(screen.getByText('Schritt 1 von 3')).toBeTruthy();
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

  it('führt bis zum Datenschutz, geht zurück und schließt ab', async () => {
    const server = fresh();
    mount(server);
    const user = userEvent.setup();
    await toSubjectsStep(user);

    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(await screen.findByRole('heading', { name: 'Datenschutz' })).toBeTruthy();
    expect(screen.getByText('Schritt 3 von 3')).toBeTruthy();
    expect(screen.getByText(/Pagewise sammelt nichts/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Zurück' }));
    expect(await screen.findByRole('heading', { name: 'Deine Fächer' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Weiter' }));

    await user.click(await screen.findByRole('button', { name: 'Los geht’s' }));
    expect(await screen.findByRole('heading', { name: 'Noch keine Fächer' })).toBeTruthy();
    expect(server.profile.onboardingCompleted).toBe(true);
    expect(screen.queryByText('Schritt 3 von 3')).toBeNull();
  });

  it('zeigt nach dem Abschluss beim nächsten Start gleich die App', async () => {
    const server = fresh();
    server.profile.onboardingCompleted = true;
    mount(server);
    expect(await screen.findByRole('heading', { name: 'Noch keine Fächer' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Dein Profil' })).toBeNull();
  });
});
