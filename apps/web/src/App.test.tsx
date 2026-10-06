// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer, json, TEST_CSRF, TEST_PASSCODE, TEST_SETUP_CODE } from './test/fake-server';

function mount(server: FakeServer) {
  const client = new ApiClient({ fetch: server.fetch });
  return render(<App client={client} />);
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  document.documentElement.removeAttribute('data-theme');
  window.localStorage.clear();
});

describe('Verbindung', () => {
  it('zeigt einen Fehler, wenn der Server nicht antwortet, und versucht es erneut', async () => {
    const server = new FakeServer('unlocked');
    server.unreachable = true;
    mount(server);

    expect(
      await screen.findByRole('heading', { name: 'Der Server antwortet nicht.' }),
    ).toBeTruthy();
    server.unreachable = false;
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('heading', { name: 'Noch keine Fächer' })).toBeTruthy();
  });
});

describe('Einrichtung', () => {
  it('prüft Länge und Wiederholung, ohne den Server zu fragen', async () => {
    const server = new FakeServer('setup');
    mount(server);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Einrichtungscode'), TEST_SETUP_CODE);
    await user.type(screen.getByLabelText('Passcode'), 'kurz');
    await user.type(screen.getByLabelText('Passcode wiederholen'), 'kurz');
    await user.click(screen.getByRole('button', { name: 'Einrichten' }));
    expect(await screen.findByText('Der Passcode braucht mindestens 8 Zeichen.')).toBeTruthy();

    await user.clear(screen.getByLabelText('Passcode'));
    await user.type(screen.getByLabelText('Passcode'), TEST_PASSCODE);
    await user.click(screen.getByRole('button', { name: 'Einrichten' }));
    expect(await screen.findByText('Die beiden Passcodes sind verschieden.')).toBeTruthy();
    expect(server.calls('POST', '/api/auth/setup')).toHaveLength(0);
  });

  it('meldet einen falschen Einrichtungscode am Feld', async () => {
    const server = new FakeServer('setup');
    mount(server);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Einrichtungscode'), 'FALSCH-FALSCH');
    await user.type(screen.getByLabelText('Passcode'), TEST_PASSCODE);
    await user.type(screen.getByLabelText('Passcode wiederholen'), TEST_PASSCODE);
    await user.click(screen.getByRole('button', { name: 'Einrichten' }));

    expect(await screen.findByText('Der Einrichtungscode stimmt nicht.')).toBeTruthy();
    expect(screen.getByLabelText('Einrichtungscode').getAttribute('aria-invalid')).toBe('true');
  });

  it('richtet ein und öffnet die App', async () => {
    const server = new FakeServer('setup');
    mount(server);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Einrichtungscode'), TEST_SETUP_CODE);
    await user.type(screen.getByLabelText('Passcode'), TEST_PASSCODE);
    await user.type(screen.getByLabelText('Passcode wiederholen'), TEST_PASSCODE);
    await user.click(screen.getByRole('button', { name: 'Einrichten' }));

    expect(await screen.findByRole('heading', { name: 'Noch keine Fächer' })).toBeTruthy();
    const setupCall = server.calls('POST', '/api/auth/setup')[0];
    expect(setupCall?.body).toEqual({ setupCode: TEST_SETUP_CODE, passcode: TEST_PASSCODE });
    // Spätere Anfragen tragen das CSRF-Token der neuen Sitzung.
    expect(server.requests.at(-1)?.headers.get('x-csrf-token')).toBe(TEST_CSRF);
  });

  it('kann den Passcode anzeigen und wieder verbergen', async () => {
    mount(new FakeServer('setup'));
    const user = userEvent.setup();
    const field = await screen.findByLabelText('Passcode');
    expect(field.getAttribute('type')).toBe('password');

    await user.click(
      screen.getAllByRole('button', { name: 'Passcode anzeigen' })[0] as HTMLElement,
    );
    expect(field.getAttribute('type')).toBe('text');
    await user.click(
      screen.getAllByRole('button', { name: 'Passcode verbergen' })[0] as HTMLElement,
    );
    expect(field.getAttribute('type')).toBe('password');
  });

  it('meldet einen zu langen Passcode mit der Meldung für zu lang', async () => {
    const server = new FakeServer('setup');
    // So antwortet der Server wirklich: reason „passcode_too_long“ ( routes/auth.ts ).
    server.replyOnce('POST', '/api/auth/setup', () =>
      json(400, { error: 'invalid_input', field: 'passcode', reason: 'passcode_too_long' }),
    );
    mount(server);
    const user = userEvent.setup();
    const zuLang = 'x'.repeat(129);

    await user.type(await screen.findByLabelText('Einrichtungscode'), TEST_SETUP_CODE);
    await user.type(screen.getByLabelText('Passcode'), zuLang);
    await user.type(screen.getByLabelText('Passcode wiederholen'), zuLang);
    await user.click(screen.getByRole('button', { name: 'Einrichten' }));

    expect(await screen.findByText('Der Passcode darf höchstens 128 Zeichen haben.')).toBeTruthy();
  });
});

describe('Anmeldung', () => {
  it('weist einen falschen Passcode ab und lässt den richtigen herein', async () => {
    const server = new FakeServer('locked');
    mount(server);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Passcode'), 'ein falscher Passcode');
    await user.click(screen.getByRole('button', { name: 'Entsperren' }));
    expect(await screen.findByText('Der Passcode stimmt nicht.')).toBeTruthy();

    await user.clear(screen.getByLabelText('Passcode'));
    await user.type(screen.getByLabelText('Passcode'), TEST_PASSCODE);
    await user.click(screen.getByRole('button', { name: 'Entsperren' }));
    expect(await screen.findByRole('heading', { name: 'Noch keine Fächer' })).toBeTruthy();
  });

  it('nennt die Wartezeit bei zu vielen Versuchen', async () => {
    const server = new FakeServer('locked');
    server.replyOnce('POST', '/api/auth/login', () =>
      json(429, { error: 'rate_limited', retryAfterSeconds: 600 }),
    );
    mount(server);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Passcode'), 'irgendein Passcode');
    await user.click(screen.getByRole('button', { name: 'Entsperren' }));
    expect(await screen.findByText('Zu viele Versuche. Bitte warte 10 Minuten.')).toBeTruthy();
  });

  it('zeigt einen Hinweis, wenn der Server unterwegs wegfällt', async () => {
    const server = new FakeServer('locked');
    mount(server);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Passcode'), TEST_PASSCODE);
    server.unreachable = true;
    await user.click(screen.getByRole('button', { name: 'Entsperren' }));
    expect(
      await screen.findByText('Der Server antwortet nicht. Läuft Pagewise noch?'),
    ).toBeTruthy();
  });

  it('springt zur Anmeldung zurück, wenn der Server die Sitzung nicht mehr kennt', async () => {
    const server = new FakeServer('unlocked');
    window.history.replaceState(null, '', '/settings');
    mount(server);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Aktueller Passcode'), TEST_PASSCODE);
    await user.type(screen.getByLabelText('Neuer Passcode'), 'ein neuer Beispiel-Passcode');
    await user.type(
      screen.getByLabelText('Neuen Passcode wiederholen'),
      'ein neuer Beispiel-Passcode',
    );

    // Die Sitzung läuft ab; die nächste Anfrage bekommt „unauthorized“.
    server.state = 'locked';
    await user.click(screen.getByRole('button', { name: 'Passcode ändern' }));
    expect(await screen.findByRole('heading', { name: 'Pagewise entsperren' })).toBeTruthy();
  });

  it('meldet beim Ändern einen zu langen Passcode mit der Meldung für zu lang', async () => {
    const server = new FakeServer('unlocked');
    // So antwortet der Server wirklich: reason „passcode_too_long“ ( routes/auth.ts ).
    server.replyOnce('POST', '/api/auth/passcode', () =>
      json(400, { error: 'invalid_input', field: 'next', reason: 'passcode_too_long' }),
    );
    window.history.replaceState(null, '', '/settings');
    mount(server);
    const user = userEvent.setup();
    const zuLang = 'x'.repeat(129);

    await user.type(await screen.findByLabelText('Aktueller Passcode'), TEST_PASSCODE);
    await user.type(screen.getByLabelText('Neuer Passcode'), zuLang);
    await user.type(screen.getByLabelText('Neuen Passcode wiederholen'), zuLang);
    await user.click(screen.getByRole('button', { name: 'Passcode ändern' }));

    expect(
      await screen.findByText('Der neue Passcode darf höchstens 128 Zeichen haben.'),
    ).toBeTruthy();
  });
});

describe('App-Rahmen', () => {
  function mountWithSubjects() {
    const server = new FakeServer('unlocked');
    const a = server.addSubject('Beispielfach A', {
      teacher: 'Beispiel-Lehrkraft',
      hoursPerWeek: 3,
      icon: 'flask',
    });
    a.groups.push({ id: 'g-1', name: 'Beispiel-Untergruppe', kind: 'Beispielart', position: 0 });
    server.addSubject('Beispielfach B');
    const view = mount(server);
    return { server, a, view };
  }

  it('scrollt beim Fachwechsel nach oben und legt den Fokus auf den Inhalt', async () => {
    const { server } = mountWithSubjects();
    const user = userEvent.setup();
    const nav = await screen.findByRole('navigation', { name: 'Navigation' });
    await user.click(within(nav).getByRole('link', { name: 'Beispielfach A' }));

    const scrollTo = vi.spyOn(window, 'scrollTo');
    await user.click(within(nav).getByRole('link', { name: 'Beispielfach B' }));

    expect(window.location.pathname).toBe(`/subjects/${server.subjects[1]?.id}`);
    expect(await screen.findByRole('heading', { name: 'Beispielfach B' })).toBeTruthy();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(document.activeElement).toBe(document.getElementById('main'));
    scrollTo.mockRestore();
  });

  it('listet die Fächer auf der Startseite mit Angaben', async () => {
    mountWithSubjects();
    const heading = await screen.findByRole('heading', { name: 'Deine Fächer' });
    const main = heading.closest('main') as HTMLElement;
    expect(within(main).getByText('Beispiel-Lehrkraft · 3 Std. pro Woche')).toBeTruthy();
    expect(within(main).getByText('1 Untergruppe')).toBeTruthy();
    expect(within(main).queryByText(/Keine Untergruppen/)).toBeNull();
  });

  it('klappt Untergruppen auf und navigiert ohne Neuladen', async () => {
    const { a } = mountWithSubjects();
    const user = userEvent.setup();
    const nav = await screen.findByRole('navigation', { name: 'Navigation' });

    expect(within(nav).queryByRole('link', { name: 'Beispiel-Untergruppe' })).toBeNull();
    await user.click(within(nav).getByRole('button', { name: /Beispielfach A: Untergruppen/ }));
    await user.click(within(nav).getByRole('link', { name: 'Beispiel-Untergruppe' }));

    expect(window.location.pathname).toBe(`/subjects/${a.id}/groups/g-1`);
    expect(await screen.findByRole('heading', { name: 'Beispiel-Untergruppe' })).toBeTruthy();
    expect(document.title).toBe('Beispiel-Untergruppe · Pagewise');
    expect(
      within(nav).getByRole('link', { name: 'Beispiel-Untergruppe' }).getAttribute('aria-current'),
    ).toBe('page');
  });

  it('öffnet beim Laden einer Fach-Adresse das Fach, aufgeklappt', async () => {
    const server = new FakeServer('unlocked');
    const a = server.addSubject('Beispielfach A');
    a.groups.push({ id: 'g-1', name: 'Beispiel-Untergruppe', kind: null, position: 0 });
    window.history.replaceState(null, '', `/subjects/${a.id}`);
    mount(server);

    expect(await screen.findByRole('heading', { name: 'Beispielfach A' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Navigation' });
    expect(within(nav).getByRole('link', { name: 'Beispiel-Untergruppe' })).toBeTruthy();
  });

  it('zeigt „gibt es nicht“ für unbekannte Fächer und Adressen', async () => {
    const server = new FakeServer('unlocked');
    window.history.replaceState(null, '', '/subjects/gibt-es-nicht');
    mount(server);
    expect(await screen.findByRole('heading', { name: 'Diese Seite gibt es nicht' })).toBeTruthy();
    // Der Tab-Titel nennt die Seite, statt nur den App-Namen zu zeigen.
    expect(document.title).toBe('Seite nicht gefunden · Pagewise');
    await userEvent.click(screen.getByRole('link', { name: 'Zur Startseite' }));
    expect(await screen.findByRole('heading', { name: 'Noch keine Fächer' })).toBeTruthy();
    expect(window.location.pathname).toBe('/');
    expect(document.title).toBe('Pagewise');
  });

  it('öffnet auf dem Handy die Schublade und schließt sie mit Escape', async () => {
    mountWithSubjects();
    const user = userEvent.setup();
    const menu = await screen.findByRole('button', { name: 'Menü öffnen' });

    await user.click(menu);
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    expect(within(drawer).getByRole('link', { name: 'Beispielfach A' })).toBeTruthy();
    // Der Hintergrund ist für Tastatur und Screenreader gesperrt.
    expect(document.getElementById('root')?.hasAttribute('inert') ?? false).toBeDefined();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(menu);
  });

  it('schließt die Schublade nach der Wahl eines Fachs', async () => {
    const { a } = mountWithSubjects();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Menü öffnen' }));
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    await user.click(within(drawer).getByRole('link', { name: 'Beispielfach B' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toMatch(/^\/subjects\//);
    expect(window.location.pathname).not.toBe(`/subjects/${a.id}`);
  });

  it('legt nach dem Fachwechsel aus der Schublade den Fokus auf den Inhalt', async () => {
    mountWithSubjects();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Menü öffnen' }));
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    await user.click(within(drawer).getByRole('link', { name: 'Beispielfach B' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Die Schublade gibt den Fokus erst an ihren Öffner zurück; da sie durch den Seitenwechsel
    // geschlossen wurde, liegt er am Ende auf dem Hauptbereich.
    expect(document.activeElement).toBe(document.getElementById('main'));
  });

  it('schließt die Schublade nach dem Anlegen eines Fachs', async () => {
    const server = new FakeServer('unlocked');
    mount(server);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Menü öffnen' }));
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    await user.click(within(drawer).getByRole('button', { name: 'Fach hinzufügen' }));

    const dialog = await screen.findByRole('dialog', { name: 'Fach anlegen' });
    await user.click(within(dialog).getByLabelText('Eigenes Fach'));
    await user.type(within(dialog).getByLabelText('Name'), 'Beispielfach C');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    // Die Schublade macht zu, das neue Fach ist angelegt, sichtbar und geöffnet.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull());
    expect(window.location.pathname).toBe(`/subjects/${server.subjects[0]?.id}`);
    expect(screen.queryByRole('dialog')).toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Navigation' });
    expect(within(nav).getByRole('link', { name: 'Beispielfach C' })).toBeTruthy();
  });
});

describe('Einstellungen', () => {
  it('schaltet die Darstellung um und merkt sie sich', async () => {
    const server = new FakeServer('unlocked');
    window.history.replaceState(null, '', '/settings');
    mount(server);
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Dunkel'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('pagewise.theme')).toBe('dark');

    await user.click(screen.getByLabelText('Wie das Gerät'));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.getItem('pagewise.theme')).toBeNull();
  });

  it('ändert den Passcode und meldet einen falschen aktuellen', async () => {
    const server = new FakeServer('unlocked');
    window.history.replaceState(null, '', '/settings');
    mount(server);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Aktueller Passcode'), 'ein falscher Passcode');
    await user.type(screen.getByLabelText('Neuer Passcode'), 'ein neuer Beispiel-Passcode');
    await user.type(
      screen.getByLabelText('Neuen Passcode wiederholen'),
      'ein neuer Beispiel-Passcode',
    );
    await user.click(screen.getByRole('button', { name: 'Passcode ändern' }));
    expect(await screen.findByText('Der aktuelle Passcode stimmt nicht.')).toBeTruthy();
    // Ein falscher Passcode wirft nicht zur Anmeldung zurück.
    expect(screen.getByRole('heading', { name: 'Einstellungen' })).toBeTruthy();

    await user.clear(screen.getByLabelText('Aktueller Passcode'));
    await user.type(screen.getByLabelText('Aktueller Passcode'), TEST_PASSCODE);
    await user.click(screen.getByRole('button', { name: 'Passcode ändern' }));
    expect(await screen.findByText(/Der Passcode ist geändert/)).toBeTruthy();
    expect((screen.getByLabelText('Aktueller Passcode') as HTMLInputElement).value).toBe('');
  });

  it('meldet ab', async () => {
    const server = new FakeServer('unlocked');
    window.history.replaceState(null, '', '/settings');
    mount(server);
    await userEvent.click(await screen.findByRole('button', { name: 'Abmelden' }));
    expect(await screen.findByRole('heading', { name: 'Pagewise entsperren' })).toBeTruthy();
    expect(server.state).toBe('locked');
  });
});

describe('Pagewise-Link: zugänglicher Name enthält den sichtbaren Text', () => {
  it('enthält in Seitenleiste und Schublade den sichtbaren Namen „Pagewise“', async () => {
    const server = new FakeServer('unlocked');
    mount(server);
    const user = userEvent.setup();
    const link = await screen.findByRole('link', { name: 'Pagewise – Standard-Chat öffnen' });
    // Label-in-Name: der sichtbare Text „Pagewise“ steckt im zugänglichen Namen.
    expect(link.textContent).toBe('Pagewise');

    // In der Schublade (schmale Breiten) trägt der Link denselben zugänglichen Namen.
    await user.click(await screen.findByRole('button', { name: 'Menü öffnen' }));
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    expect(
      within(drawer).getByRole('link', { name: 'Pagewise – Standard-Chat öffnen' }).textContent,
    ).toBe('Pagewise');
  });
});
