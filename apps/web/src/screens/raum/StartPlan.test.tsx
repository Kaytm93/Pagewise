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

/** Fügt eine Stunde am Montag (5. Oktober 2026) ein und setzt die feste Uhr. */
function lessonsAt(clock: [number, number], slots: Array<[string, string]>) {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach A', { icon: 'flask', color: 0 });
  for (const [startTime, endTime] of slots) {
    server.addLesson({ weekday: 1, startTime, endTime, subjectId: subject.id, room: 'B12' });
  }
  vi.setSystemTime(new Date(2026, 9, 5, clock[0], clock[1], 0));
  return server;
}

const cssVar = (element: Element | null, name: string) =>
  (element as HTMLElement | null)?.style.getPropertyValue(name);

describe('Zeitachse in „Raum“ (feste Uhr, erfundene Zeiten)', () => {
  it('setzt Beginn, Dauer und Marke als CSS-Variablen aus der Uhrzeit', async () => {
    document.documentElement.setAttribute('data-design', 'raum');
    const { server } = setup();
    const { container } = renderHome(server);
    const plan = await findPlan(container);

    // 08:00 bis 12:15 = 255 Minuten, die kürzeste Stunde 45 Minuten: 1,4 Pixel je Minute.
    const axis = plan.querySelector('.rm-plan-list');
    expect(cssVar(axis, '--tl-span')).toBe('255');
    expect(cssVar(axis, '--tl-unit')).toBe('1.4px');

    const items = [...plan.querySelectorAll('.rm-plan-item')];
    expect(items.map((item) => cssVar(item, '--at'))).toEqual(['0', '110', '210']);
    expect(items.map((item) => cssVar(item, '--len'))).toEqual(['45', '65', '45']);

    const breaks = [...plan.querySelectorAll('.rm-plan-break')];
    expect(breaks.map((item) => cssVar(item, '--at'))).toEqual(['45', '175']);
    expect(breaks.map((item) => cssVar(item, '--len'))).toEqual(['65', '35']);

    // 10:02 = 122 Minuten ab 08:00 (171 px). Die Stunde ab 09:50 beginnt 17 px davor: der Zettel rückt unter die Marke.
    const marker = plan.querySelector('.rm-plan-now');
    expect(cssVar(marker, '--now')).toBe('122');
    expect(cssVar(marker, '--now-shift')).toBe('3');
    expect(marker?.querySelector('.rm-plan-now-dot')).not.toBeNull();
  });

  it('stellt die Marke vor die erste Stunde, solange der Tag nicht begonnen hat', async () => {
    document.documentElement.setAttribute('data-design', 'raum');
    const server = lessonsAt([7, 30], [['08:00', '08:45']]);
    const { container } = renderHome(server);
    const plan = await findPlan(container);

    const marker = plan.querySelector('.rm-plan-now') as HTMLElement;
    expect(cssVar(marker, '--now')).toBe('0');
    expect(marker.textContent).toContain('Jetzt 07:30');
    expect(marker.nextElementSibling?.getAttribute('data-state')).toBe('next');
    expect(marker.getAttribute('role')).toBeNull();
  });

  it('stellt die Marke ans Ende, wenn alle Stunden vorbei sind', async () => {
    document.documentElement.setAttribute('data-design', 'raum');
    const server = lessonsAt(
      [14, 0],
      [
        ['08:00', '08:45'],
        ['09:50', '10:35'],
      ],
    );
    const { container } = renderHome(server);
    const plan = await findPlan(container);

    const marker = plan.querySelector('.rm-plan-now') as HTMLElement;
    expect(cssVar(marker, '--now')).toBe('155');
    expect(marker.nextElementSibling).toBeNull();
    const states = [...plan.querySelectorAll('.rm-plan-item')].map((item) =>
      item.getAttribute('data-state'),
    );
    expect(states).toEqual(['past', 'past']);
  });

  it('macht aus einer Lücke von fünf Minuten eine Pause, aus drei Minuten nicht', async () => {
    document.documentElement.setAttribute('data-design', 'raum');
    // Lücke 08:45–08:50 (5 Min.) steht als Pause da; 09:35–09:38 (3 Min.) nicht.
    const server = lessonsAt(
      [8, 47],
      [
        ['08:00', '08:45'],
        ['08:50', '09:35'],
        ['09:38', '10:20'],
      ],
    );
    const { container } = renderHome(server);
    const plan = await findPlan(container);

    const breaks = [...plan.querySelectorAll('.rm-plan-break')] as HTMLElement[];
    expect(breaks).toHaveLength(1);
    expect(breaks[0]?.textContent).toContain('5 Minuten');
    // Fünf Minuten sind zu kurz für eine Beschriftung neben der Linie: nur der Screenreader liest sie.
    expect(breaks[0]?.querySelector('.sr-only')).not.toBeNull();

    // Mitten in der Lücke: die erste Stunde ist vorbei, die zweite kommt, die Marke steht dazwischen.
    const items = [...plan.querySelectorAll('.rm-plan-item')];
    expect(items.map((item) => item.getAttribute('data-state'))).toEqual(['past', 'next', 'next']);
    const marker = plan.querySelector('.rm-plan-now') as HTMLElement;
    expect(cssVar(marker, '--now')).toBe('47');
    expect(marker.previousElementSibling).toBe(breaks[0]);
    expect(marker.nextElementSibling).toBe(items[1]);
  });

  it('zeigt ohne Stunden von heute keine Marke und keine Achse', async () => {
    document.documentElement.setAttribute('data-design', 'raum');
    const { server } = setup({ lessons: false, otherDay: true });
    const { container } = renderHome(server);
    const plan = await findPlan(container);

    expect(plan.querySelector('.rm-plan-now')).toBeNull();
    expect(plan.querySelector('.rm-plan-list')).toBeNull();
  });

  it('legt überschneidende Stunden nicht übereinander', async () => {
    document.documentElement.setAttribute('data-design', 'raum');
    const server = lessonsAt(
      [8, 10],
      [
        ['08:00', '09:00'],
        ['08:30', '09:30'],
      ],
    );
    const { container } = renderHome(server);
    const plan = await findPlan(container);

    const items = [...plan.querySelectorAll('.rm-plan-item')];
    // Die zweite Karte beginnt dort, wo die erste endet; ihre Anzeige bleibt „08:30“.
    expect(items.map((item) => cssVar(item, '--at'))).toEqual(['0', '60']);
    expect(items.map((item) => cssVar(item, '--len'))).toEqual(['60', '30']);
    expect(items[1]?.querySelector('time')?.textContent).toContain('08:30');
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
