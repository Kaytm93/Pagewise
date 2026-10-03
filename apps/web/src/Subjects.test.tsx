// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer } from './test/fake-server';

function mount(server: FakeServer) {
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

const nav = () => screen.getByRole('navigation', { name: 'Navigation' });

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('Fächer anlegen', () => {
  it('legt ein Fach mit allen Angaben an und öffnet es', async () => {
    const server = new FakeServer('unlocked');
    mount(server);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Fach anlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fach anlegen' });
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Name'));

    await user.type(within(dialog).getByLabelText('Name'), '  Beispielfach A ');
    await user.type(within(dialog).getByLabelText(/Lehrkraft/), 'Beispiel-Lehrkraft');
    await user.type(within(dialog).getByLabelText(/Stunden pro Woche/), '3');
    await user.click(within(dialog).getByLabelText('Kolben'));
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByRole('heading', { name: 'Beispielfach A' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(server.calls('POST', '/api/subjects')[0]?.body).toEqual({
      name: 'Beispielfach A',
      teacher: 'Beispiel-Lehrkraft',
      hoursPerWeek: 3,
      icon: 'flask',
    });
    expect(window.location.pathname).toBe(`/subjects/${server.subjects[0]?.id}`);
    expect(within(nav()).getByRole('link', { name: 'Beispielfach A' })).toBeTruthy();
  });

  it('lässt sich über die Seitenleiste öffnen und mit Escape schließen', async () => {
    mount(new FakeServer('unlocked'));
    const user = userEvent.setup();
    const add = await within(
      await screen.findByRole('navigation', { name: 'Navigation' }),
    ).findByRole('button', { name: 'Fach hinzufügen' });
    await user.click(add);
    await screen.findByRole('dialog', { name: 'Fach anlegen' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(add);
  });

  it('prüft Eingaben, bevor etwas gesendet wird', async () => {
    const server = new FakeServer('unlocked');
    mount(server);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Fach anlegen' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(within(dialog).getByText(/Namen mit 1 bis 80 Zeichen/)).toBeTruthy();

    await user.type(within(dialog).getByLabelText('Name'), 'Beispielfach');
    await user.type(within(dialog).getByLabelText(/Stunden pro Woche/), '41');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(within(dialog).getByText('Bitte gib eine ganze Zahl von 1 bis 40 ein.')).toBeTruthy();
    expect(server.calls('POST', '/api/subjects')).toHaveLength(0);
  });

  it('meldet einen doppelten Namen am Feld', async () => {
    const server = new FakeServer('unlocked');
    server.addSubject('Beispielfach A');
    mount(server);
    const user = userEvent.setup();
    await user.click(
      await within(await screen.findByRole('navigation')).findByRole('button', {
        name: 'Fach hinzufügen',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'BEISPIELFACH A');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    expect(
      await within(dialog).findByText('Ein Fach mit diesem Namen gibt es schon.'),
    ).toBeTruthy();
    expect(within(dialog).getByLabelText('Name').getAttribute('aria-invalid')).toBe('true');
    // Der Dialog bleibt offen, die Eingabe bleibt erhalten.
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe(
      'BEISPIELFACH A',
    );
  });
});

describe('Fach bearbeiten und löschen', () => {
  function open(server: FakeServer) {
    const subject = server.addSubject('Beispielfach A', {
      teacher: 'Beispiel-Lehrkraft',
      hoursPerWeek: 3,
    });
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    return subject;
  }

  it('ändert Angaben und leert optionale Felder', async () => {
    const server = new FakeServer('unlocked');
    const subject = open(server);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fach bearbeiten' });
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe(
      'Beispielfach A',
    );
    expect((within(dialog).getByLabelText(/Lehrkraft/) as HTMLInputElement).value).toBe(
      'Beispiel-Lehrkraft',
    );

    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Beispielfach Neu');
    await user.clear(within(dialog).getByLabelText(/Lehrkraft/));
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByRole('heading', { name: 'Beispielfach Neu' })).toBeTruthy();
    expect(server.calls('PATCH', `/api/subjects/${subject.id}`)[0]?.body).toMatchObject({
      name: 'Beispielfach Neu',
      teacher: null,
      hoursPerWeek: 3,
    });
    expect(document.title).toBe('Beispielfach Neu · Pagewise');
  });

  it('löscht erst nach Rückfrage und geht zur Startseite', async () => {
    const server = new FakeServer('unlocked');
    const subject = open(server);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await user.click(await screen.findByRole('button', { name: 'Fach löschen' }));
    const confirm = await screen.findByRole('dialog', { name: 'Fach „Beispielfach A“ löschen?' });
    expect(within(confirm).getByText(/Das lässt sich nicht rückgängig machen/)).toBeTruthy();

    // Abbrechen löscht nichts.
    await user.click(within(confirm).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /löschen\?/ })).toBeNull());
    expect(server.calls('DELETE', `/api/subjects/${subject.id}`)).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: 'Fach bearbeiten' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Fach löschen' }));
    await user.click(await screen.findByRole('button', { name: 'Löschen' }));

    expect(await screen.findByRole('heading', { name: 'Noch keine Fächer' })).toBeTruthy();
    expect(window.location.pathname).toBe('/');
    expect(server.subjects).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Untergruppen', () => {
  function open(server: FakeServer) {
    const subject = server.addSubject('Beispielfach A');
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    return subject;
  }

  it('zeigt einen Leerzustand und legt eine Untergruppe an', async () => {
    const server = new FakeServer('unlocked');
    const subject = open(server);
    const user = userEvent.setup();

    expect(await screen.findByText('Noch keine Untergruppen')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Untergruppe hinzufügen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Untergruppe anlegen' });
    await user.type(within(dialog).getByLabelText('Name'), 'Beispiel-Thema');
    await user.type(within(dialog).getByLabelText(/Art/), 'Beispielart');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByRole('heading', { name: 'Beispiel-Thema' })).toBeTruthy();
    expect(screen.getByText('Beispielart')).toBeTruthy();
    expect(server.calls('POST', `/api/subjects/${subject.id}/groups`)[0]?.body).toEqual({
      name: 'Beispiel-Thema',
      kind: 'Beispielart',
    });
    // Die Seitenleiste zeigt sie unter dem Fach.
    expect(within(nav()).getByRole('link', { name: 'Beispiel-Thema' })).toBeTruthy();
    // Auf der Untergruppe gibt es den Rückweg zum Fach.
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: 'Beispielfach A' }),
    ).toBeTruthy();
  });

  it('meldet einen doppelten Namen im selben Fach', async () => {
    const server = new FakeServer('unlocked');
    const subject = open(server);
    subject.groups.push({ id: 'g-1', name: 'Beispiel-Thema', kind: null, position: 0 });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Untergruppe hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'beispiel-thema');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(
      await within(dialog).findByText(
        'In diesem Fach gibt es schon eine Untergruppe mit diesem Namen.',
      ),
    ).toBeTruthy();
  });

  it('benennt eine Untergruppe um', async () => {
    const server = new FakeServer('unlocked');
    const subject = open(server);
    subject.groups.push({ id: 'g-1', name: 'Beispiel-Thema', kind: null, position: 0 });
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole('button', { name: 'Untergruppe „Beispiel-Thema“ bearbeiten' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Untergruppe bearbeiten' });
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Anderes Thema');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      await within(screen.getByRole('main')).findByRole('link', { name: 'Anderes Thema' }),
    ).toBeTruthy();
    expect(server.calls('PATCH', '/api/groups/g-1')[0]?.body).toEqual({
      name: 'Anderes Thema',
      kind: null,
    });
  });

  it('löscht eine Untergruppe von ihrer eigenen Seite und kehrt zum Fach zurück', async () => {
    const server = new FakeServer('unlocked');
    const subject = server.addSubject('Beispielfach A');
    subject.groups.push({ id: 'g-1', name: 'Beispiel-Thema', kind: null, position: 0 });
    window.history.replaceState(null, '', `/subjects/${subject.id}/groups/g-1`);
    mount(server);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await user.click(await screen.findByRole('button', { name: 'Untergruppe löschen' }));
    const confirm = await screen.findByRole('dialog', {
      name: 'Untergruppe „Beispiel-Thema“ löschen?',
    });
    await user.click(within(confirm).getByRole('button', { name: 'Löschen' }));

    expect(await screen.findByText('Noch keine Untergruppen')).toBeTruthy();
    expect(window.location.pathname).toBe(`/subjects/${subject.id}`);
    expect(subject.groups).toEqual([]);
  });
});
