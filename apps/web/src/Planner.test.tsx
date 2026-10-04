// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer } from './test/fake-server';

// Montag, 5. Oktober 2026, 9:17 Uhr. Alle Daten sind erfunden.
const NOW = new Date(2026, 9, 5, 9, 17);

function open(server: FakeServer, path: string) {
  window.history.replaceState(null, '', path);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

function setup() {
  const server = new FakeServer('unlocked');
  const chemie = server.addSubject('Beispiel-Chemie');
  const latein = server.addSubject('Beispiel-Latein');
  return { server, chemie, latein };
}

beforeAll(async () => {
  await import('./screens/chat/ChatPage');
}, 30_000);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

const time = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });

describe('Stundenplan', () => {
  it('zeigt einen Leerzustand und trägt eine Stunde ein', async () => {
    const { server, chemie } = setup();
    open(server, '/timetable');
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Stundenplan', level: 1 })).toBeTruthy();
    expect(await screen.findByText('Noch keine Stunden')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Stunde hinzufügen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Stunde hinzufügen' });
    await user.selectOptions(within(dialog).getByLabelText('Wochentag'), '3');
    time(within(dialog).getByLabelText('Von'), '09:50');
    time(within(dialog).getByLabelText('Bis'), '10:35');
    await user.selectOptions(within(dialog).getByLabelText('Fach'), chemie.id);
    await user.type(within(dialog).getByLabelText(/Raum/), 'Raum 12');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.calls('POST', '/api/timetable')[0]?.body).toEqual({
      weekday: 3,
      startTime: '09:50',
      endTime: '10:35',
      subjectId: chemie.id,
      room: 'Raum 12',
      note: null,
      week: 'all',
    });
    const wednesday = within(screen.getByRole('region', { name: 'Mittwoch' }));
    expect(wednesday.getByText('Beispiel-Chemie')).toBeTruthy();
    expect(wednesday.getByText('09:50–10:35')).toBeTruthy();
    expect(wednesday.getByText('Raum 12')).toBeTruthy();
  });

  it('prüft die Zeiten und warnt bei Überschneidungen, ohne sie zu verbieten', async () => {
    const { server, chemie } = setup();
    server.addLesson({ weekday: 1, startTime: '08:00', endTime: '08:45', subjectId: chemie.id });
    open(server, '/timetable');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Stunde hinzufügen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Stunde hinzufügen' });
    time(within(dialog).getByLabelText('Von'), '09:00');
    time(within(dialog).getByLabelText('Bis'), '08:30');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByText('Das Ende muss nach dem Beginn liegen.')).toBeTruthy();
    expect(server.calls('POST', '/api/timetable')).toHaveLength(0);

    time(within(dialog).getByLabelText('Von'), '08:30');
    time(within(dialog).getByLabelText('Bis'), '09:15');
    expect(
      await within(dialog).findByText(/überschneidet sich mit Beispiel-Chemie \(08:00–08:45\)/),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(server.timetable).toHaveLength(2));
    // Beide Stunden stehen da, die zweite mit Hinweis auf die Überschneidung.
    expect((await screen.findAllByText(/Überschneidet sich mit/)).length).toBeGreaterThan(0);
  });

  it('markiert die laufende Stunde mit der Restzeit', async () => {
    const { server, chemie } = setup();
    server.addLesson({ weekday: 1, startTime: '09:00', endTime: '09:50', subjectId: chemie.id });
    server.addLesson({ weekday: 1, startTime: '10:00', endTime: '10:45' });
    open(server, '/timetable');
    const monday = within(await screen.findByRole('region', { name: /^Montag/ }));
    const running = await monday.findByRole('button', { name: /Beispiel-Chemie, 09:00–09:50/ });
    expect(running.getAttribute('aria-current')).toBe('time');
    expect(within(running).getByText('Läuft gerade, noch 33 Min.')).toBeTruthy();
    const other = monday.getByRole('button', { name: /Ohne Fach, 10:00–10:45/ });
    expect(other.getAttribute('aria-current')).toBeNull();
    // Die heutige Spalte trägt den Hinweis „Heute“.
    expect(monday.getByText('Heute')).toBeTruthy();
  });

  it('bearbeitet und löscht eine Stunde mit Rückfrage', async () => {
    const { server, chemie } = setup();
    const lesson = server.addLesson({ weekday: 2, subjectId: chemie.id, room: 'R1' });
    open(server, '/timetable');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Beispiel-Chemie, 08:00–08:45/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Stunde bearbeiten' });
    expect((within(dialog).getByLabelText(/Raum/) as HTMLInputElement).value).toBe('R1');
    time(within(dialog).getByLabelText('Bis'), '09:00');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(server.timetable[0]?.endTime).toBe('09:00'));
    expect(server.calls('PATCH', `/api/timetable/${lesson.id}`)[0]?.body).toMatchObject({
      endTime: '09:00',
    });

    await user.click(await screen.findByRole('button', { name: /Beispiel-Chemie, 08:00–09:00/ }));
    const again = await screen.findByRole('dialog', { name: 'Stunde bearbeiten' });
    await user.click(within(again).getByRole('button', { name: 'Stunde löschen' }));
    await user.click(await screen.findByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(server.timetable).toEqual([]));
    expect(await screen.findByText('Noch keine Stunden')).toBeTruthy();
  });

  it('legt die Wochenart fest und zeigt nur passende Stunden', async () => {
    const { server } = setup();
    server.addLesson({
      weekday: 1,
      startTime: '08:00',
      endTime: '08:45',
      note: 'nur A',
      week: 'a',
    });
    server.addLesson({
      weekday: 1,
      startTime: '09:00',
      endTime: '09:45',
      note: 'nur B',
      week: 'b',
    });
    server.addLesson({ weekday: 1, startTime: '10:00', endTime: '10:45', note: 'immer' });
    open(server, '/timetable');
    const user = userEvent.setup();
    const monday = () => within(screen.getByRole('region', { name: /^Montag/ }));
    expect(await screen.findByText('nur A')).toBeTruthy();
    // Ohne festgelegte Woche gelten alle Stunden.
    expect(monday().getAllByRole('button')).toHaveLength(3);

    const week = within(screen.getByRole('group', { name: 'Diese Woche ist' }));
    await user.click(week.getByRole('radio', { name: 'B' }));
    await waitFor(() => expect(server.weekAnchor).toEqual({ monday: '2026-10-05', week: 'b' }));
    expect(server.calls('PUT', '/api/timetable/week')[0]?.body).toEqual({
      anchor: { date: '2026-10-05', week: 'b' },
    });
    // Die Ansicht folgt jetzt nicht von selbst, der Filter „Anzeigen“ entscheidet.
    const filter = within(screen.getByRole('group', { name: 'Anzeigen' }));
    await user.click(filter.getByRole('radio', { name: 'Woche B' }));
    expect(monday().queryByText('nur A')).toBeNull();
    expect(monday().getByText('nur B')).toBeTruthy();
    expect(monday().getByText('immer')).toBeTruthy();
    await user.click(filter.getByRole('radio', { name: 'Woche A' }));
    expect(monday().getByText('nur A')).toBeTruthy();
    expect(monday().queryByText('nur B')).toBeNull();

    await user.click(week.getByRole('radio', { name: 'Weiß ich nicht' }));
    await waitFor(() => expect(server.weekAnchor).toBeNull());
  });

  it('zeigt Fehler beim Laden mit „Erneut versuchen“', async () => {
    const { server } = setup();
    server.replyOnce('GET', '/api/timetable', () => new Response('{}', { status: 500 }));
    open(server, '/timetable');
    const user = userEvent.setup();
    expect(
      await screen.findByText('Stundenplan und Tests konnten nicht geladen werden.'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText('Noch keine Stunden')).toBeTruthy();
  });
});

describe('Tests', () => {
  it('zeigt Leerzustand, verlangt ein Fach und trägt einen Test ein', async () => {
    const server = new FakeServer('unlocked');
    open(server, '/exams');
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Tests', level: 1 })).toBeTruthy();
    expect(await screen.findByText('Noch keine Tests')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Test eintragen' }));
    expect(await screen.findByText(/Lege zuerst ein Fach an/)).toBeTruthy();
  });

  it('trägt einen Test ein und zeigt Abstand, Fach und Themen', async () => {
    const { server, chemie } = setup();
    open(server, '/exams');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Test eintragen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Test eintragen' });
    await user.selectOptions(within(dialog).getByLabelText('Fach'), chemie.id);
    await user.type(within(dialog).getByLabelText('Art'), 'Schulaufgabe');
    fireEvent.change(within(dialog).getByLabelText('Datum'), { target: { value: '2026-10-08' } });
    time(within(dialog).getByLabelText(/Uhrzeit/), '10:00');
    await user.type(within(dialog).getByLabelText('Themen'), 'Säuren und Basen');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(server.exams).toHaveLength(1));
    expect(server.calls('POST', '/api/exams')[0]?.body).toEqual({
      subjectId: chemie.id,
      kind: 'Schulaufgabe',
      title: null,
      date: '2026-10-08',
      time: '10:00',
      topics: 'Säuren und Basen',
      notes: null,
    });
    const row = await screen.findByRole('button', { name: /Schulaufgabe, Beispiel-Chemie/ });
    expect(within(row).getByText('in 3 Tagen')).toBeTruthy();
    expect(within(row).getByText('Säuren und Basen')).toBeTruthy();
    expect(within(row).getByText(/10:00 Uhr/)).toBeTruthy();
  });

  it('prüft die Eingaben', async () => {
    const { server } = setup();
    open(server, '/exams');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Test eintragen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Test eintragen' });
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByText(/Bitte gib eine Art an/)).toBeTruthy();
    expect(server.calls('POST', '/api/exams')).toHaveLength(0);
  });

  it('trennt Anstehendes von Vergangenem und lässt Einträge bearbeiten und löschen', async () => {
    const { server, chemie, latein } = setup();
    server.addExam(chemie.id, { kind: 'Ex', date: '2026-10-06' });
    server.addExam(latein.id, { kind: 'Referat', title: 'Rom', date: '2026-10-05' });
    server.addExam(chemie.id, { kind: 'Test', date: '2026-10-01' });
    open(server, '/exams');
    const user = userEvent.setup();
    const upcoming = within(await screen.findByRole('region', { name: 'Anstehend' }));
    const rows = upcoming.getAllByRole('button');
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      '„Referat: Rom, Beispiel-Latein“ bearbeiten',
      '„Ex, Beispiel-Chemie“ bearbeiten',
    ]);
    expect(within(rows[0] as HTMLElement).getByText('heute')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('morgen')).toBeTruthy();
    // Vergangenes ist eingeklappt, aber vorhanden.
    const past = screen.getByText(/Vergangen \(1\)/).closest('details');
    expect(past?.open).toBe(false);
    expect(within(past as HTMLElement).getByText('vor 4 Tagen')).toBeTruthy();

    await user.click(rows[1] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Eintrag bearbeiten' });
    await user.clear(within(dialog).getByLabelText('Art'));
    await user.type(within(dialog).getByLabelText('Art'), 'Klausur');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(server.exams.some((e) => e.kind === 'Klausur')).toBe(true));

    await user.click(await screen.findByRole('button', { name: /Klausur, Beispiel-Chemie/ }));
    const again = await screen.findByRole('dialog', { name: 'Eintrag bearbeiten' });
    await user.click(within(again).getByRole('button', { name: 'Eintrag löschen' }));
    await user.click(await screen.findByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(server.exams.some((e) => e.kind === 'Klausur')).toBe(false));
  });
});

describe('Startseite: Als Nächstes', () => {
  it('sagt, wie lange die Stunde noch dauert, und zeigt den nächsten Test als Zettel', async () => {
    const { server, chemie, latein } = setup();
    server.addLesson({
      weekday: 1,
      startTime: '09:00',
      endTime: '09:50',
      subjectId: chemie.id,
      room: 'C03',
    });
    server.addLesson({ weekday: 1, startTime: '11:00', endTime: '11:45', subjectId: latein.id });
    server.addExam(chemie.id, { kind: 'Schulaufgabe', date: '2026-10-08', time: '10:00' });
    server.addExam(latein.id, { kind: 'Ex', date: '2026-10-20' });
    open(server, '/');
    const section = within(await screen.findByRole('region', { name: 'Als Nächstes' }));
    expect(await section.findByText('Jetzt: Beispiel-Chemie, noch 33 Minuten')).toBeTruthy();
    expect(section.getByText('Als Nächstes: Beispiel-Latein um 11:00 Uhr')).toBeTruthy();
    expect(section.getByText('Raum C03')).toBeTruthy();
    expect(section.getByText('in 3 Tagen')).toBeTruthy();
    expect(section.getByText(/Schulaufgabe · Beispiel-Chemie/)).toBeTruthy();
    expect(section.getByText(/Donnerstag, 8\. Oktober, 10:00 Uhr/)).toBeTruthy();
    expect(section.getByRole('link', { name: 'Alle Tests' })).toBeTruthy();
  });

  it('weist ohne Stundenplan darauf hin und bleibt ohne Tests freundlich', async () => {
    const { server } = setup();
    open(server, '/');
    const section = within(await screen.findByRole('region', { name: 'Als Nächstes' }));
    expect(section.getByText('Du hast noch keinen Stundenplan eingetragen.')).toBeTruthy();
    expect(section.getByRole('link', { name: 'Stundenplan eintragen' })).toBeTruthy();
    expect(section.getByText('Keine Tests eingetragen.')).toBeTruthy();
  });

  it('sagt, wenn heute nichts mehr kommt, und nennt die nächste Stunde', async () => {
    const { server, chemie } = setup();
    server.addLesson({ weekday: 1, startTime: '08:00', endTime: '08:45', subjectId: chemie.id });
    server.addLesson({ weekday: 3, startTime: '10:00', endTime: '10:45', subjectId: chemie.id });
    open(server, '/');
    const section = within(await screen.findByRole('region', { name: 'Als Nächstes' }));
    expect(
      await section.findByText('Nächste Stunde: Beispiel-Chemie, Mittwoch um 10:00 Uhr'),
    ).toBeTruthy();
    expect(section.getByText('Heute stehen keine Stunden mehr an.')).toBeTruthy();
  });

  it('zeigt nichts, wenn die Daten nicht geladen werden konnten', async () => {
    const { server } = setup();
    server.replyOnce('GET', '/api/timetable', () => new Response('{}', { status: 500 }));
    open(server, '/');
    await screen.findByRole('heading', { name: 'Womit fangen wir an?' });
    expect(screen.queryByRole('region', { name: 'Als Nächstes' })).toBeNull();
  });
});

describe('Fachseite und Navigation', () => {
  it('zeigt die nächsten Tests des Fachs und trägt mit vorgewähltem Fach ein', async () => {
    const { server, chemie, latein } = setup();
    server.addExam(chemie.id, { kind: 'Schulaufgabe', date: '2026-10-08' });
    server.addExam(latein.id, { kind: 'Ex', date: '2026-10-09' });
    open(server, `/subjects/${chemie.id}`);
    const user = userEvent.setup();
    const section = within(await screen.findByRole('region', { name: 'Anstehende Tests' }));
    expect(
      await section.findByRole('button', { name: /Schulaufgabe, Beispiel-Chemie/ }),
    ).toBeTruthy();
    expect(section.queryByRole('button', { name: /Ex, Beispiel-Latein/ })).toBeNull();

    await user.click(section.getByRole('button', { name: 'Test eintragen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Test eintragen' });
    expect((within(dialog).getByLabelText('Fach') as HTMLSelectElement).value).toBe(chemie.id);
  });

  it('führt über die Seitenleiste zu Stundenplan und Tests', async () => {
    const { server } = setup();
    open(server, '/');
    const user = userEvent.setup();
    const nav = within(await screen.findByRole('navigation', { name: 'Navigation' }));
    await user.click(nav.getByRole('link', { name: 'Stundenplan' }));
    expect(await screen.findByRole('heading', { name: 'Stundenplan', level: 1 })).toBeTruthy();
    expect(window.location.pathname).toBe('/timetable');
    expect(nav.getByRole('link', { name: 'Stundenplan' }).getAttribute('aria-current')).toBe(
      'page',
    );
    await user.click(nav.getByRole('link', { name: 'Tests' }));
    expect(await screen.findByRole('heading', { name: 'Tests', level: 1 })).toBeTruthy();
    expect(window.location.pathname).toBe('/exams');
  });
});
