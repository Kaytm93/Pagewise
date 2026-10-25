// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { ApiClient } from '../../api/client';
import { FakeServer } from '../../test/fake-server';

/*
 * Startseite in „Atelier“: Tagesliste mit „Jetzt“-Linie und großer Zeile für die laufende oder nächste Stunde,
 * rechts die Zahl der Tage bis zum nächsten Test, der Stoff, der Wochenstreifen (Montag bis Freitag) und die
 * zwei Wege weiter. „Raum“ behält seinen Stundenplan. Alle Daten sind erfunden („Beispielfach A“, „Raum B12“).
 */

const NOW = new Date(2026, 9, 5, 10, 2, 0);

function setup({ lessons = true, exam = true, topics = 'Säuren\nBasen' } = {}) {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach A', { icon: 'flask', color: 0 });
  if (lessons) {
    server.addLesson({
      weekday: 1,
      startTime: '08:00',
      endTime: '08:45',
      subjectId: subject.id,
      room: 'Raum B12',
    });
    server.addLesson({
      weekday: 1,
      startTime: '09:50',
      endTime: '10:55',
      subjectId: subject.id,
      room: 'Raum B12',
    });
    server.addLesson({
      weekday: 1,
      startTime: '11:30',
      endTime: '12:15',
      subjectId: subject.id,
      room: 'Raum B12',
    });
  }
  if (exam) {
    server.addExam(subject.id, {
      kind: 'Schulaufgabe',
      date: '2026-10-08',
      topics: topics === '' ? null : topics,
    });
  }
  return { server, subject };
}

function renderHome(server: FakeServer) {
  window.history.replaceState(null, '', '/');
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-design');
});

describe('Startseite in „Atelier“', () => {
  it('zeigt Tagesliste mit „Jetzt“-Linie, große Zahl, Stoff, Wochenstreifen und Wege weiter', async () => {
    document.documentElement.setAttribute('data-design', 'atelier');
    const { server, subject } = setup();
    const { container } = renderHome(server);

    const day = within(await screen.findByRole('region', { name: 'Als Nächstes' }));
    expect(day.getByText('Heute, 3 Stunden')).toBeTruthy();

    // Reihenfolge: vorbei, Pause, „Jetzt“, laufende Stunde (große Zeile), Pause, nächste Stunde.
    const list = container.querySelector('.at-day') as HTMLElement;
    const kinds = [...list.children].map((item) =>
      item.classList.contains('at-now')
        ? 'jetzt'
        : item.classList.contains('at-break')
          ? 'pause'
          : (item.getAttribute('data-state') ?? '?'),
    );
    expect(kinds).toEqual(['past', 'pause', 'jetzt', 'now', 'pause', 'next']);
    expect(list.querySelector('.at-now')?.textContent).toBe('Jetzt 10:02');
    expect(list.querySelectorAll('.at-break')[0]?.textContent).toBe('Pause · 65 Minuten');

    // Die laufende Stunde ist die große Zeile: ein Link auf das Fach mit Zeit, Raum und Restzeit.
    const lead = list.querySelector('[data-lead="true"]') as HTMLElement;
    expect(lead.getAttribute('data-state')).toBe('now');
    const leadLink = lead.querySelector('a') as HTMLAnchorElement;
    expect(leadLink.getAttribute('href')).toBe(`/subjects/${subject.id}`);
    expect(leadLink.getAttribute('aria-current')).toBe('time');
    expect(leadLink.textContent).toContain('09:50');
    expect(leadLink.textContent).toContain('Raum B12 · noch 53 Min.');
    expect(list.querySelectorAll('[data-lead]')).toHaveLength(1);

    // Vorbei trägt das Wort, nicht nur die graue Farbe.
    expect(list.querySelector('[data-state="past"]')?.textContent).toContain('vorbei');
    expect(list.querySelector('[data-state="next"]')?.textContent).toContain('11:30');

    // Anstehend: Zahl (nur für Augen), Worte, Stoff.
    const test = within(screen.getByRole('region', { name: 'Anstehend' }));
    expect(container.querySelector('.at-count-num')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.at-count-num')?.textContent).toBe('3');
    expect(container.querySelector('.at-count-what')?.textContent).toBe(
      'in 3 TagenSchulaufgabe Beispielfach A, Donnerstag, 8. Oktober',
    );
    expect(container.querySelector('.at-topics')?.textContent).toBe(
      'Stoff laut Plan: Säuren, Basen',
    );

    // Wochenstreifen: Montag bis Freitag, heute markiert, Test am Donnerstag mit dem Namen der Prüfung.
    expect(test.getByRole('heading', { name: 'Diese Woche' })).toBeTruthy();
    const columns = [...container.querySelectorAll('.at-week-item')] as HTMLElement[];
    expect(columns.map((column) => column.querySelector('.at-week-day')?.textContent)).toEqual([
      'Mo 5.',
      'Di 6.',
      'Mi 7.',
      'Do 8.',
      'Fr 9.',
    ]);
    expect(columns[0]?.getAttribute('aria-current')).toBe('date');
    expect(columns[0]?.textContent).toContain('heute');
    expect(columns[3]?.getAttribute('data-test')).toBe('true');
    expect(columns[3]?.textContent).toContain('Schulaufgabe');
    expect(columns.filter((column) => column.hasAttribute('data-test'))).toHaveLength(1);

    // Wege weiter: mit Stoff gibt es „Zum Fach“, immer „Alle Tests“ und den Stundenplan.
    expect(test.getByRole('link', { name: 'Zum Fach' }).getAttribute('href')).toBe(
      `/subjects/${subject.id}`,
    );
    expect(test.getByRole('link', { name: 'Alle Tests' })).toBeTruthy();
    expect(day.getByRole('link', { name: 'Zum Stundenplan' })).toBeTruthy();
  });

  it('legt „Jetzt“ in die Pause und nennt deren Ende, die nächste Stunde ist die große Zeile', async () => {
    vi.setSystemTime(new Date(2026, 9, 5, 9, 20, 0));
    document.documentElement.setAttribute('data-design', 'atelier');
    const { server } = setup();
    const { container } = renderHome(server);

    await screen.findByRole('region', { name: 'Als Nächstes' });
    const list = container.querySelector('.at-day') as HTMLElement;
    expect(list.querySelector('.at-now')?.textContent).toBe('Jetzt 09:20, Pause bis 09:50');
    // Keine zweite Pausenzeile für dieselbe Lücke; die spätere Pause (35 Minuten) bleibt.
    expect([...list.querySelectorAll('.at-break')].map((item) => item.textContent)).toEqual([
      'Pause · 35 Minuten',
    ]);
    const lead = list.querySelector('[data-lead="true"]') as HTMLElement;
    expect(lead.getAttribute('data-state')).toBe('next');
    expect(lead.textContent).toContain('Raum B12 · in 30 Min.');
  });

  it('zeigt am Wochenende die kommende Woche', async () => {
    vi.setSystemTime(new Date(2026, 9, 10, 11, 0, 0));
    document.documentElement.setAttribute('data-design', 'atelier');
    const { server } = setup();
    const { container } = renderHome(server);

    await screen.findByRole('region', { name: 'Anstehend' });
    expect(screen.getByRole('heading', { name: 'Nächste Woche' })).toBeTruthy();
    const days = [...container.querySelectorAll('.at-week-day')].map((item) => item.textContent);
    expect(days).toEqual(['Mo 12.', 'Di 13.', 'Mi 14.', 'Do 15.', 'Fr 16.']);
    expect(container.querySelector('.at-week-item[aria-current]')).toBeNull();
  });

  it('lässt ohne Themen Stoff und „Zum Fach“ weg', async () => {
    document.documentElement.setAttribute('data-design', 'atelier');
    const { server } = setup({ topics: '' });
    const { container } = renderHome(server);

    await screen.findByRole('region', { name: 'Anstehend' });
    expect(container.querySelector('.at-topics')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Zum Fach' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Alle Tests' })).toBeTruthy();
  });

  it('zeigt in „Raum“ weder Tagesliste noch Wochenstreifen', async () => {
    document.documentElement.setAttribute('data-design', 'raum');
    const { server } = setup();
    const { container } = renderHome(server);

    await waitFor(() => expect(container.querySelector('.rm-plan')).not.toBeNull());
    expect(container.querySelector('.at-day')).toBeNull();
    expect(container.querySelector('.at-week')).toBeNull();
    expect(container.querySelector('.at-count')).toBeNull();
  });

  it('weist ohne Stundenplan auf das Eintragen hin', async () => {
    document.documentElement.setAttribute('data-design', 'atelier');
    const { server } = setup({ lessons: false });
    const { container } = renderHome(server);

    await screen.findByRole('region', { name: 'Als Nächstes' });
    expect(screen.getByText('Du hast noch keinen Stundenplan eingetragen.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Stundenplan eintragen' })).toBeTruthy();
    expect(container.querySelector('.at-day')).toBeNull();
  });

  it('nennt ohne Test den Leerzustand und den Weg zum Eintragen', async () => {
    document.documentElement.setAttribute('data-design', 'atelier');
    const { server } = setup({ exam: false });
    const { container } = renderHome(server);

    await screen.findByRole('region', { name: 'Anstehend' });
    expect(screen.getByText('Keine Tests eingetragen.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Test eintragen' })).toBeTruthy();
    expect(container.querySelector('.at-count')).toBeNull();
    // Der Wochenstreifen bleibt: heute ist markiert.
    expect(container.querySelector('.at-week-item[aria-current="date"]')).not.toBeNull();
  });

  it('nennt ohne Stunden und ohne Test beide Leerzustände', async () => {
    document.documentElement.setAttribute('data-design', 'atelier');
    const { server } = setup({ lessons: false, exam: false });
    renderHome(server);

    await screen.findByRole('region', { name: 'Als Nächstes' });
    expect(screen.getByText('Du hast noch keinen Stundenplan eingetragen.')).toBeTruthy();
    expect(screen.getByText('Keine Tests eingetragen.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Test eintragen' })).toBeTruthy();
  });
});
