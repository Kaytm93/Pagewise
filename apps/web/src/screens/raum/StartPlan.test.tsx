// @vitest-environment jsdom
import { render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { ApiClient } from '../../api/client';
import { FakeServer } from '../../test/fake-server';

/*
 * Startseite in „Raum“: eigener Stundenplan mit Zuständen, Pausen und „Jetzt“-Linie. „Lagen“ behält
 * seine Stundenliste. Alle Daten sind erfunden („Beispielfach A“, „Raum B12“).
 */

const NOW = new Date(2026, 9, 5, 10, 2, 0);

function setup({ lessons = true, otherDay = false } = {}) {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach A', { icon: 'flask', color: 0 });
  if (lessons) {
    server.addLesson({
      weekday: 1,
      startTime: '08:00',
      endTime: '08:45',
      subjectId: subject.id,
      room: 'B12',
    });
    server.addLesson({
      weekday: 1,
      startTime: '09:50',
      endTime: '10:55',
      subjectId: subject.id,
      room: 'B12',
    });
    server.addLesson({
      weekday: 1,
      startTime: '11:30',
      endTime: '12:15',
      subjectId: subject.id,
      room: 'B12',
    });
  }
  if (otherDay) {
    server.addLesson({
      weekday: 2,
      startTime: '08:00',
      endTime: '08:45',
      subjectId: subject.id,
      room: 'B12',
    });
  }
  return { server, subject };
}

function renderHome(server: FakeServer) {
  window.history.replaceState(null, '', '/');
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

async function findPlan(container: HTMLElement): Promise<HTMLElement> {
  return waitFor(() => {
    const plan = container.querySelector('.rm-plan') as HTMLElement | null;
    expect(plan).not.toBeNull();
    return plan as HTMLElement;
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-design');
});

describe('Startseite in „Raum“', () => {
  it('zeigt Stundenplan mit Zuständen, Pausen und „Jetzt“-Linie', async () => {
    document.documentElement.setAttribute('data-design', 'raum');
    const { server } = setup();
    const { container } = renderHome(server);

    const plan = await findPlan(container);
    expect(within(plan).getByText('Montag')).toBeTruthy();
    expect(within(plan).getByText('5. Oktober')).toBeTruthy();
    expect(within(plan).getByText('3 Stunden')).toBeTruthy();

    const items = [...plan.querySelectorAll('.rm-plan-item')] as HTMLElement[];
    expect(items.map((item) => item.getAttribute('data-state'))).toEqual(['past', 'now', 'next']);

    const now = items[1] as HTMLElement;
    expect(now.getAttribute('aria-current')).toBe('time');
    expect(now.textContent).toContain('Raum B12');
    expect(now.textContent).toContain('noch 53 Min.');

    expect((items[2] as HTMLElement).textContent).toContain('als Nächstes');
    expect((items[0] as HTMLElement).textContent).toContain('vorbei');

    const marker = plan.querySelector('.rm-plan-now') as HTMLElement;
    expect(marker.textContent).toContain('Jetzt 10:02');
    expect(marker.textContent).toContain('noch 53 Minuten');
    expect(plan.querySelectorAll('.rm-plan-now-line')).toHaveLength(1);

    // Zwei Lücken: 08:45–09:50 (65 Min.) und 10:55–11:30 (35 Min.).
    const breaks = [...plan.querySelectorAll('.rm-plan-break')] as HTMLElement[];
    expect(breaks).toHaveLength(2);
    expect(breaks[0]?.textContent).toContain('65 Minuten');
    expect(breaks[1]?.textContent).toContain('35 Minuten');

    // Die Linie steht vor der laufenden Stunde.
    expect(marker.nextElementSibling).toBe(now);
  });

  it('zeigt ohne Stunden am heutigen Tag den Hinweis', async () => {
    document.documentElement.setAttribute('data-design', 'raum');
    const { server } = setup({ lessons: false, otherDay: true });
    const { container } = renderHome(server);

    const plan = await findPlan(container);
    expect(within(plan).getByText('Heute keine Stunden')).toBeTruthy();
    expect(within(plan).getByRole('link', { name: 'Stundenplan eintragen' })).toBeTruthy();
  });

  it('zeigt ohne Stundenplan den Hinweis zum Eintragen', async () => {
    document.documentElement.setAttribute('data-design', 'raum');
    const { server } = setup({ lessons: false });
    const { container } = renderHome(server);

    const plan = await findPlan(container);
    expect(within(plan).getByText('Du hast noch keinen Stundenplan eingetragen.')).toBeTruthy();
    expect(within(plan).getByRole('link', { name: 'Stundenplan eintragen' })).toBeTruthy();
  });
});

describe('Startseite in „Lagen“', () => {
  it('zeigt den Stundenplan aus „Raum“ nicht', async () => {
    document.documentElement.setAttribute('data-design', 'lagen');
    const { server } = setup();
    const { container } = renderHome(server);

    await waitFor(() => expect(container.querySelector('.lg-lessons')).not.toBeNull());
    expect(container.querySelector('.rm-plan')).toBeNull();
    expect(container.querySelector('.rm-plan-now')).toBeNull();
  });
});
