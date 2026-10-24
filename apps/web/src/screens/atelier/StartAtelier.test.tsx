// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { ApiClient } from '../../api/client';
import { FakeServer } from '../../test/fake-server';

/*
 * Startseite in „Atelier“: Leitkarte mit der nächsten Stunde, große Zahl, Wochenstreifen mit sieben
 * Spalten und die übrigen Stunden von heute. „Raum“ behält seinen Stundenplan. Alle Daten sind erfunden
 * („Beispielfach A“, „Raum B12“).
 */

const NOW = new Date(2026, 9, 5, 10, 2, 0);

function setup({ lessons = true, exam = true } = {}) {
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
    server.addExam(subject.id, { kind: 'Schulaufgabe', date: '2026-10-08' });
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
  it('zeigt Leitkarte, große Zahl, Wochenstreifen und die nächsten Stunden', async () => {
    document.documentElement.setAttribute('data-design', 'atelier');
    const { server, subject } = setup();
    const { container } = renderHome(server);

    const start = within(await screen.findByRole('region', { name: 'Als Nächstes' }));

    // Leitkarte: ein Link auf das Fach mit Zeit und Raum.
    const lead = container.querySelector('.at-lead-link') as HTMLAnchorElement;
    expect(lead).not.toBeNull();
    expect(lead.getAttribute('href')).toBe(`/subjects/${subject.id}`);
    expect(lead.textContent).toContain('als Nächstes');
    expect(lead.textContent).toContain('Beispielfach A');
    expect(lead.textContent).toContain('09:50');
    expect(lead.textContent).toContain('Raum B12');

    // Große Zahl: Tage bis zum Test, darunter das Fach.
    const count = container.querySelector('.at-count') as HTMLElement;
    expect(count.querySelector('.at-count-num')?.textContent).toBe('33 Tage');
    expect(count.querySelector('.at-count-sub')?.textContent).toBe('bis Beispielfach A');

    // Wochenstreifen: sieben Spalten, heute markiert, Balkenhöhe aus der Stundenzahl.
    const week = start.getByRole('heading', { name: 'Diese Woche' });
    expect(week).toBeTruthy();
    const columns = [...container.querySelectorAll('.at-week-col')] as HTMLElement[];
    expect(columns).toHaveLength(7);
    expect(columns[0]?.getAttribute('aria-current')).toBe('date');
    expect(within(columns[0] as HTMLElement).getByText('heute')).toBeTruthy();
    const bars = columns.map(
      (column) => (column.querySelector('.at-week-bar') as HTMLElement).style,
    );
    expect(bars[0]?.getPropertyValue('--at-bar')).toBe('3');
    expect(bars[1]?.getPropertyValue('--at-bar')).toBe('0');

    // Übrige Stunden von heute, höchstens vier, darunter der Weg zum Stundenplan.
    const items = [...container.querySelectorAll('.at-next-item')] as HTMLElement[];
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain('11:30');
    expect(items[0]?.textContent).toContain('Raum B12');
    expect(start.getByRole('link', { name: 'Zum Stundenplan' })).toBeTruthy();
  });

  it('zeigt in „Raum“ weder Leitkarte noch Wochenstreifen', async () => {
    document.documentElement.setAttribute('data-design', 'raum');
    const { server } = setup();
    const { container } = renderHome(server);

    await waitFor(() => expect(container.querySelector('.rm-plan')).not.toBeNull());
    expect(container.querySelector('.at-lead')).toBeNull();
    expect(container.querySelector('.at-week-grid')).toBeNull();
    expect(container.querySelector('.at-count')).toBeNull();
  });

  it('weist ohne Stundenplan auf das Eintragen hin', async () => {
    document.documentElement.setAttribute('data-design', 'atelier');
    const { server } = setup({ lessons: false });
    const { container } = renderHome(server);

    await screen.findByRole('region', { name: 'Als Nächstes' });
    expect(screen.getByText('Du hast noch keinen Stundenplan eingetragen.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Stundenplan eintragen' })).toBeTruthy();
    expect(container.querySelector('.at-next-item')).toBeNull();
  });

  it('zeigt ohne Test die Zahl der Stunden von heute', async () => {
    document.documentElement.setAttribute('data-design', 'atelier');
    const { server } = setup({ exam: false });
    const { container } = renderHome(server);

    await screen.findByRole('region', { name: 'Als Nächstes' });
    const count = container.querySelector('.at-count') as HTMLElement;
    expect(count.querySelector('.at-count-num')?.textContent).toBe('3Stunden heute');
    expect(count.querySelector('.at-count-sub')?.textContent).toBe('Stunden heute');
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
