// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { ApiClient } from '../../api/client';
import { FakeServer } from '../../test/fake-server';

/*
 * M1-T1: Die Startseite bekommt in der Richtung „Lagen“ eine eigene Komposition aus Stundenliste,
 * „Jetzt“-Marke, Testzettel und „Zuletzt genutzt“. Die Richtungen „Raum“ und „Atelier“ behalten
 * Tageslinie und „Als Nächstes“. Alle Daten sind erfunden.
 */

const NOW = new Date(2026, 9, 5, 10, 2, 0);

function setup({ lessons = true, exam = true, chat = false } = {}) {
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
      title: 'Beispielarbeit',
      date: '2026-10-08',
      time: '10:00',
      topics: 'Beispielthema Eins\nBeispielthema Zwei',
      notes: null,
    });
  }
  if (chat) {
    server.addChat(subject.id, { title: 'Beispielchat zum Wiederholen' });
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

describe('Startseite in „Lagen“', () => {
  it('zeigt Stundenliste mit drei Zuständen, „Jetzt“-Marke und Zettel', async () => {
    document.documentElement.setAttribute('data-design', 'lagen');
    const { server } = setup({ chat: true });
    const { container } = renderHome(server);

    await screen.findByText('Schulaufgabe Beispielfach A');
    const list = container.querySelector('.lg-lessons') as HTMLElement;
    expect(list).not.toBeNull();
    expect(within(list).getByText('09:50')).toBeTruthy();
    expect(within(list).getAllByText('Raum B12')).toHaveLength(3);

    const states = [...list.querySelectorAll('.lg-lesson')].map((item) =>
      item.getAttribute('data-state'),
    );
    expect(states).toEqual(['past', 'now', 'next']);

    const now = list.querySelector('[data-state="now"]') as HTMLElement;
    expect(now.getAttribute('aria-current')).toBe('time');
    expect(within(now).getByText('noch 53 Minuten')).toBeTruthy();
    expect(within(now).getByRole('link', { name: 'Fach öffnen' })).toBeTruthy();

    const marker = within(list).getByText(/^Jetzt/);
    expect(marker.textContent).toBe('Jetzt 10:02');

    const slip = container.querySelector('.lg-slip') as HTMLElement;
    expect(slip).not.toBeNull();
    expect(within(slip).getByText('in 3 Tagen')).toBeTruthy();
    expect(within(slip).getByText(/Donnerstag, 8\. Oktober/)).toBeTruthy();
    expect(within(slip).getByText('Beispielthema Eins')).toBeTruthy();
    expect(within(slip).getByText('2 Themen')).toBeTruthy();

    expect(await screen.findByText('Zuletzt genutzt')).toBeTruthy();
    expect(screen.getByText('Beispielchat zum Wiederholen')).toBeTruthy();
  });

  it('lässt in „Raum“ Stundenliste und Zettelthemen weg, zeigt aber „Zuletzt genutzt“', async () => {
    document.documentElement.setAttribute('data-design', 'raum');
    const { server } = setup({ chat: true });
    const { container } = renderHome(server);

    await waitFor(() => expect(container.querySelector('.rm-day-list')).not.toBeNull());
    expect(container.querySelector('.lg-lessons')).toBeNull();
    expect(container.querySelector('.lg-topics')).toBeNull();
    expect(await screen.findByText('Zuletzt genutzt')).toBeTruthy();
    expect(screen.getByText('Beispielchat zum Wiederholen')).toBeTruthy();
  });

  it('zeigt „Zuletzt genutzt“ auch in „Atelier“ und lässt es ohne Chats weg', async () => {
    document.documentElement.setAttribute('data-design', 'atelier');
    const withChat = setup({ chat: true });
    const first = renderHome(withChat.server);
    expect(await screen.findByText('Zuletzt genutzt')).toBeTruthy();
    expect(screen.getByText('Beispielchat zum Wiederholen')).toBeTruthy();
    first.unmount();

    const { server, subject } = setup({ chat: false });
    renderHome(server);
    await waitFor(() =>
      expect(server.calls('GET', `/api/chats?subjectId=${subject.id}`)).toHaveLength(1),
    );
    expect(screen.queryByText('Zuletzt genutzt')).toBeNull();
  });

  it('nennt in der Überschrift die Stunden von heute und den nächsten Test', async () => {
    document.documentElement.setAttribute('data-design', 'lagen');
    const { server } = setup({ chat: false });
    renderHome(server);

    const heading = await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(heading.textContent).not.toBe('Womit fangen wir an?'));
    expect(heading.textContent).toBe(
      'Noch 2 Stunden heute, Schulaufgabe Beispielfach A in 3 Tagen.',
    );
  });

  it('zeigt ohne Stunden den Hinweis mit Link zum Stundenplan', async () => {
    document.documentElement.setAttribute('data-design', 'lagen');
    const { server } = setup({ lessons: false });
    renderHome(server);

    expect(await screen.findByText('Du hast noch keinen Stundenplan eingetragen.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Stundenplan eintragen' })).toBeTruthy();
  });

  it('zeigt ohne Test den Hinweis mit Link zu den Tests', async () => {
    document.documentElement.setAttribute('data-design', 'lagen');
    const { server } = setup({ exam: false });
    renderHome(server);

    expect(await screen.findByText('Keine Tests eingetragen.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Test eintragen' })).toBeTruthy();
  });

  it('lässt „Zuletzt genutzt“ ohne Chats ganz weg', async () => {
    document.documentElement.setAttribute('data-design', 'lagen');
    const { server, subject } = setup({ chat: false });
    renderHome(server);

    await screen.findByText('Schulaufgabe Beispielfach A');
    await waitFor(() =>
      expect(server.calls('GET', `/api/chats?subjectId=${subject.id}`)).toHaveLength(1),
    );
    expect(screen.queryByText('Zuletzt genutzt')).toBeNull();
  });
});

describe('Pausen in der Stundenliste von „Lagen“', () => {
  it('setzt bei einer Lücke ab 5 Minuten eine Pausenzeile, bei kleineren nicht', async () => {
    document.documentElement.setAttribute('data-design', 'lagen');
    const server = new FakeServer('unlocked');
    const subject = server.addSubject('Beispielfach A', { icon: 'flask', color: 0 });
    // 3 Minuten Lücke: nur ein Wechsel; 20 Minuten Lücke: Pause; 5 Minuten: gerade noch Pause.
    const stunden: [string, string][] = [
      ['08:00', '08:45'],
      ['08:48', '09:30'],
      ['09:50', '10:55'],
      ['11:00', '11:45'],
    ];
    for (const [startTime, endTime] of stunden) {
      server.addLesson({ weekday: 1, startTime, endTime, subjectId: subject.id, room: null });
    }
    const { container } = renderHome(server);

    const list = (await waitFor(() => {
      const found = container.querySelector('.lg-lessons');
      expect(found).not.toBeNull();
      return found;
    })) as HTMLElement;

    const pausen = [...list.querySelectorAll('.lg-lesson-break')];
    expect(pausen.map((pause) => pause.textContent)).toEqual([
      '09:30Pause · 20 Minuten',
      '10:55Pause · 5 Minuten',
    ]);
    // Reihenfolge: Pause steht vor der Marke, die Marke vor der laufenden Stunde.
    expect([...list.children].map((item) => item.className.split(' ')[0])).toEqual([
      'lg-lesson',
      'lg-lesson',
      'lg-lesson-break',
      'lg-now-marker',
      'lg-lesson',
      'lg-lesson-break',
      'lg-lesson',
    ]);
    // Stundenzeilen bleiben, was sie waren: Zustände nur an .lg-lesson.
    expect(
      [...list.querySelectorAll('.lg-lesson')].map((item) => item.getAttribute('data-state')),
    ).toEqual(['past', 'past', 'now', 'next']);
  });

  it('setzt die Stundennamen auf 21 px (Tailwind-Größe, keine alte 18 px)', async () => {
    document.documentElement.setAttribute('data-design', 'lagen');
    const { server } = setup();
    const { container } = renderHome(server);
    await screen.findByText('Schulaufgabe Beispielfach A');

    const name = container.querySelector('.lg-lesson-name') as HTMLElement;
    expect(name.className).toContain('text-[1.3125rem]');
    expect(name.className).not.toContain('text-lg');
  });
});

describe('„Zuletzt genutzt“ trägt die Haken für den großen ersten Eintrag', () => {
  it('gibt jedem Eintrag Fachname, Titel und Symbol als eigene Hakenklassen', async () => {
    document.documentElement.setAttribute('data-design', 'lagen');
    const { server, subject } = setup({ chat: true });
    server.addChat(subject.id, { title: 'Zweiter Beispielchat' });
    const { container } = renderHome(server);

    await screen.findByText('Zuletzt genutzt');
    const liste = container.querySelector('.lg-recent') as HTMLElement;
    const eintraege = [...liste.children];
    expect(eintraege).toHaveLength(2);
    for (const eintrag of eintraege) {
      expect(eintrag.querySelector('.lg-recent-subject')?.textContent).toBe('Beispielfach A');
      expect(eintrag.querySelector('.lg-recent-title')).not.toBeNull();
      expect(eintrag.querySelector('.lg-recent-icon')).not.toBeNull();
      expect(eintrag.querySelector('a.lg-row')).not.toBeNull();
    }
  });
});
