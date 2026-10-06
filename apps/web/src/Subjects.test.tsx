// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer } from './test/fake-server';

function mount(server: FakeServer) {
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

const nav = () => screen.getByRole('navigation', { name: 'Navigation' });

// Die Auswahl der Vorlagen und der Prompt-Dialog werden erst beim Öffnen geladen. Auf einem langsamen
// Rechner dauert das länger als die Wartezeit eines einzelnen Tests, deshalb einmal vorab laden.
beforeAll(async () => {
  await import('./screens/subjects/TemplatePicker');
}, 30_000);

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
    // Der Katalog ist der Standardweg, die Suche hat den Fokus.
    const search = await within(dialog).findByLabelText('Fach suchen');
    await waitFor(() => expect(document.activeElement).toBe(search));
    await user.click(within(dialog).getByLabelText('Eigenes Fach'));

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
    await user.click(within(dialog).getByLabelText('Eigenes Fach'));

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
    await user.click(within(dialog).getByLabelText('Eigenes Fach'));
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

describe('Fächer aus dem Katalog anlegen', () => {
  async function openDialog(server: FakeServer) {
    mount(server);
    const user = userEvent.setup();
    // Ohne Fächer heißt der Knopf „Fach anlegen“, sonst „Fach hinzufügen“.
    const [open] = await screen.findAllByRole('button', { name: /^Fach (anlegen|hinzufügen)$/ });
    await user.click(open as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Fach anlegen' });
    await within(dialog).findByLabelText('Fach suchen');
    return { user, dialog };
  }

  it('zeigt Kategorien, öffnet die erste und lässt andere aufklappen', async () => {
    const { user, dialog } = await openDialog(new FakeServer('unlocked'));
    expect(
      within(dialog)
        .getByRole('button', { name: /^Beispiele/ })
        .getAttribute('aria-expanded'),
    ).toBe('true');
    expect(within(dialog).getByLabelText(/Beispielfach A/)).toBeTruthy();
    const other = within(dialog).getByRole('button', { name: /^Weitere Beispiele/ });
    expect(other.getAttribute('aria-expanded')).toBe('false');
    expect(within(dialog).queryByLabelText(/Übungsfach C/)).toBeNull();
    await user.click(other);
    expect(within(dialog).getByLabelText(/Übungsfach C/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /^Beispiele/ }));
    expect(within(dialog).queryByLabelText(/Beispielfach A/)).toBeNull();
  });

  it('legt mehrere gewählte Fächer mit Schlüssel der Vorlage an, die Auswahl bleibt über die Suche erhalten', async () => {
    const server = new FakeServer('unlocked');
    const { user, dialog } = await openDialog(server);
    const submit = within(dialog).getByRole('button', {
      name: 'Fächer anlegen',
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    await user.click(within(dialog).getByLabelText(/Beispielfach A/));
    // Gefunden über den anderen Namen, und die Auswahl von eben bleibt.
    await user.type(within(dialog).getByLabelText('Fach suchen'), 'erdfach');
    expect(within(dialog).getByText('auch: Erdfach')).toBeTruthy();
    expect(within(dialog).queryByLabelText(/Beispielfach A/)).toBeNull();
    await user.click(within(dialog).getByLabelText(/Übungsfach C/));
    expect(within(dialog).getByText('2 ausgewählt')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: '2 Fächer anlegen' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const posts = server.calls('POST', '/api/subjects').map((call) => call.body);
    expect(posts).toEqual([
      { name: 'Beispielfach A', icon: 'book', templateKey: 'beispiel-a' },
      { name: 'Übungsfach C', icon: null, templateKey: 'beispiel-c' },
    ]);
    expect(server.subjects.map((subject) => subject.templateKey)).toEqual([
      'beispiel-a',
      'beispiel-c',
    ]);
    // Nur Namen: keine Lehrkraft, keine Stunden, kein Prompt.
    expect(server.calls('PUT', `/api/prompts/subjects/${server.subjects[0]?.id}`)).toHaveLength(0);
    expect(within(nav()).getByRole('link', { name: 'Beispielfach A' })).toBeTruthy();
    expect(within(nav()).getByRole('link', { name: 'Übungsfach C' })).toBeTruthy();
    // Mehrere neue Fächer: die Ansicht bleibt, bei genau einem öffnet sich das Fach.
    expect(window.location.pathname).toBe('/');
  });

  it('behält die gewählten Vorlagen, wenn man zum eigenen Fach wechselt und zurück', async () => {
    const { user, dialog } = await openDialog(new FakeServer('unlocked'));
    await user.click(within(dialog).getByLabelText(/Beispielfach A/));
    expect(within(dialog).getByText('1 ausgewählt')).toBeTruthy();

    // Der Katalog bleibt montiert: die Auswahl überlebt den Weg zum eigenen Fach und zurück.
    await user.click(within(dialog).getByLabelText('Eigenes Fach'));
    expect(within(dialog).getByLabelText('Name')).toBeTruthy();
    await user.click(within(dialog).getByLabelText('Aus dem Katalog'));
    const box = within(dialog).getByLabelText(/Beispielfach A/, {
      selector: 'input',
    }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(within(dialog).getByText('1 ausgewählt')).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: '1 Fach anlegen' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it('öffnet bei genau einem neuen Fach dessen Seite', async () => {
    const server = new FakeServer('unlocked');
    const { user, dialog } = await openDialog(server);
    await user.click(within(dialog).getByLabelText(/Beispielfach B/));
    await user.click(within(dialog).getByRole('button', { name: '1 Fach anlegen' }));
    expect(await screen.findByRole('heading', { name: 'Beispielfach B' })).toBeTruthy();
    expect(window.location.pathname).toBe(`/subjects/${server.subjects[0]?.id}`);
  });

  it('markiert vorhandene Fächer als „Schon angelegt“, auch wenn sie umbenannt wurden', async () => {
    const server = new FakeServer('unlocked');
    server.addSubject('Beispielfach A');
    server.addSubject('Mein Name für B', { templateKey: 'beispiel-b' });
    const { dialog } = await openDialog(server);
    for (const name of [/Beispielfach A/, /Beispielfach B/]) {
      const box = within(dialog).getByLabelText(name, { selector: 'input' }) as HTMLInputElement;
      expect(box.disabled).toBe(true);
      expect(box.checked).toBe(true);
    }
    expect(within(dialog).getAllByText('Schon angelegt')).toHaveLength(2);
  });

  it('findet Fächer ohne Beachtung von Groß- und Kleinschreibung und Umlauten', async () => {
    const { user, dialog } = await openDialog(new FakeServer('unlocked'));
    await user.type(within(dialog).getByLabelText('Fach suchen'), 'UEBUNGSFACH');
    expect(within(dialog).getByLabelText(/Übungsfach C/)).toBeTruthy();
  });

  it('bietet bei einer erfolglosen Suche ein eigenes Fach mit dem getippten Namen an', async () => {
    const server = new FakeServer('unlocked');
    const { user, dialog } = await openDialog(server);
    await user.type(within(dialog).getByLabelText('Fach suchen'), 'Gibt es nicht');
    expect(within(dialog).getByText('Dazu gibt es keine Vorlage.')).toBeTruthy();
    await user.click(
      within(dialog).getByRole('button', { name: '„Gibt es nicht“ als eigenes Fach anlegen' }),
    );
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Gibt es nicht');
    expect(server.calls('POST', '/api/subjects')).toHaveLength(0);
  });

  it('lässt den reservierten Namen „Standard“ bei einem eigenen Fach nicht zu', async () => {
    const server = new FakeServer('unlocked');
    const { user, dialog } = await openDialog(server);
    await user.click(within(dialog).getByLabelText('Eigenes Fach'));
    await user.type(within(dialog).getByLabelText('Name'), 'standard');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(
      await within(dialog).findByText(/Der Name „Standard“ gehört dem eingebauten Standard-Fach/),
    ).toBeTruthy();
    expect(server.subjects).toHaveLength(0);
  });

  it('zeigt ohne Katalog einen Hinweis, aber der Weg zum eigenen Fach bleibt', async () => {
    const server = new FakeServer('unlocked');
    server.catalog = { categories: [], subjects: [] };
    const { user, dialog } = await openDialog(server);
    expect(await within(dialog).findByText('Es gibt keine Vorlagen.')).toBeTruthy();
    await user.click(within(dialog).getByLabelText('Eigenes Fach'));
    expect(within(dialog).getByLabelText('Name')).toBeTruthy();
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

describe('Fachfarbe', () => {
  it('zeigt die Farbe des Fachs, lässt sie ändern und färbt die Ansicht', async () => {
    const server = new FakeServer('unlocked');
    const subject = server.addSubject('Beispielfach A', { color: 2 });
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    const user = userEvent.setup();

    // Die Fachfarbe steht als Attribut am Schreibtisch und am Eintrag der Seitenleiste.
    await screen.findByRole('heading', { name: 'Beispielfach A', level: 1 });
    expect(document.querySelector('.lg-app')?.getAttribute('data-subj')).toBe('2');

    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fach bearbeiten' });
    const colors = within(dialog).getByRole('group', { name: 'Farbe' });
    expect(
      (within(colors).getByRole('radio', { name: 'Olivgrün' }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(within(colors).getAllByRole('radio')).toHaveLength(8);
    await user.click(within(colors).getByRole('radio', { name: 'Schieferblau' }));
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() =>
      expect(document.querySelector('.lg-app')?.getAttribute('data-subj')).toBe('4'),
    );
    expect(server.calls('PATCH', `/api/subjects/${subject.id}`)[0]?.body).toMatchObject({
      color: 4,
    });
  });

  it('wählt beim Anlegen ohne Auswahl keine Farbe aus, der Server vergibt sie', async () => {
    const server = new FakeServer('unlocked');
    mount(server);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Fach hinzufügen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fach anlegen' });
    await user.click(within(dialog).getByLabelText('Eigenes Fach'));
    await user.type(within(dialog).getByLabelText('Name'), 'Beispielfach B');
    expect(within(dialog).getByText(/wählt Pagewise eine Farbe/)).toBeTruthy();
    for (const radio of within(dialog).getAllByRole('radio', { name: /Petrol|Terrakotta|Ocker/ })) {
      expect((radio as HTMLInputElement).checked).toBe(false);
    }
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(server.subjects).toHaveLength(1));
    const body = server.calls('POST', '/api/subjects')[0]?.body as Record<string, unknown>;
    expect('color' in body).toBe(false);
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

  it('bricht die Meta-Zeile um und hält die Ghost-Knöpfe einzeilig (Klassen)', async () => {
    // jsdom kann Layout nicht messen; der Echtbrowser-Test prüft scrollWidth (siehe Task-Bericht).
    const server = new FakeServer('unlocked');
    const subject = server.addSubject('Beispielfach A', {
      teacher: 'Beispiel-Lehrkraft-mit-sehr-langem-Namen',
      hoursPerWeek: 3,
    });
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);

    await screen.findByRole('heading', { name: 'Beispielfach A' });
    const meta = screen.getByText('Beispiel-Lehrkraft-mit-sehr-langem-Namen · 3 Std. pro Woche');
    expect(meta.className).toContain('break-words');

    const addGroup = within(screen.getByRole('region', { name: 'Untergruppen' })).getByRole(
      'button',
      { name: 'Untergruppe hinzufügen' },
    );
    expect(addGroup.className).toContain('whitespace-nowrap');
    expect(addGroup.className).toContain('shrink-0');

    const examsRegion = await screen.findByRole('region', { name: 'Anstehende Tests' });
    const addExam = within(examsRegion).getByRole('button', { name: 'Test eintragen' });
    expect(addExam.className).toContain('whitespace-nowrap');
    expect(addExam.className).toContain('shrink-0');
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
