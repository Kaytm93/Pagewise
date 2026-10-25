// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { ApiClient } from '../../api/client';
import { FakeServer } from '../../test/fake-server';

/*
 * M1-T2: Die Fachseite bekommt in der Richtung „Lagen“ einen eigenen Kopf mit meta-rows, Reiter in
 * Registerform und eine nach Tagen gruppierte Chatliste. „Raum“ behält den bisherigen Aufbau.
 * Alle Namen und Zeiten sind erfunden.
 */

const NOW = new Date(2026, 9, 17, 12, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function setup() {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach Lagen', {
    teacher: 'Beispielkraft',
    hoursPerWeek: 4,
    icon: 'flask',
    color: 0,
  });
  server.addGroup(subject.id, 'Beispielgruppe Eins');
  server.addGroup(subject.id, 'Beispielgruppe Zwei');
  server.addChat(subject.id, { title: 'Beispielchat heute', updatedAt: NOW.getTime() - HOUR });
  server.addChat(subject.id, {
    title: 'Beispielchat gestern',
    updatedAt: NOW.getTime() - 26 * HOUR,
  });
  server.addChat(subject.id, {
    title: 'Beispielchat diese Woche',
    updatedAt: NOW.getTime() - 3 * DAY,
  });
  server.addChat(subject.id, {
    title: 'Beispielchat früher',
    updatedAt: NOW.getTime() - 20 * DAY,
  });
  return { server, subject };
}

function mount(server: FakeServer, path: string) {
  window.history.replaceState(null, '', path);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-design');
});

describe('Fachseite in „Lagen“', () => {
  it('zeigt meta-rows mit Modell-Chip, Register-Reiter und Tagesgruppen', async () => {
    document.documentElement.setAttribute('data-design', 'lagen');
    const { server, subject } = setup();
    const { container } = mount(server, `/subjects/${subject.id}`);

    await screen.findByRole('heading', { level: 1, name: 'Beispielfach Lagen' });

    const meta = container.querySelector('.lg-meta-rows');
    expect(meta).not.toBeNull();
    const rows = within(meta as HTMLElement);
    expect(rows.getByText('Modell')).toBeTruthy();
    expect(rows.getByText('Standardmodell')).toBeTruthy();
    expect(rows.getByRole('link', { name: 'Standardmodell' }).getAttribute('href')).toBe(
      '#model-heading',
    );
    expect(rows.getByText('Stunden')).toBeTruthy();
    expect(rows.getByText('4 Std. pro Woche')).toBeTruthy();
    expect(rows.getByText('Untergruppen')).toBeTruthy();
    expect(rows.getByText('2')).toBeTruthy();
    expect(rows.getByText('Lehrkraft')).toBeTruthy();
    expect(rows.getByText('Beispielkraft')).toBeTruthy();

    const tabs = screen.getByRole('tablist', { name: 'Inhalt' });
    expect(tabs.classList.contains('lg-register')).toBe(true);

    await waitFor(() => expect(container.querySelector('.lg-chats')).not.toBeNull());
    const chats = within(container.querySelector('.lg-chats') as HTMLElement);
    expect(chats.getByText('Heute')).toBeTruthy();
    expect(chats.getByText('Gestern')).toBeTruthy();
    expect(chats.getByText('Diese Woche')).toBeTruthy();
    expect(chats.getByText('Früher')).toBeTruthy();
    expect(chats.getByText('Beispielchat heute')).toBeTruthy();
    expect(chats.getByText('Beispielchat früher')).toBeTruthy();
  });

  it('zeigt im eingebauten Fach „Standard“ nur Modell und Untergruppen', async () => {
    document.documentElement.setAttribute('data-design', 'lagen');
    const { server } = setup();
    mount(server, `/subjects/${server.defaultSubject.id}`);
    await waitFor(() => expect(document.querySelector('.lg-meta-rows')).not.toBeNull());

    const rows = within(document.querySelector('.lg-meta-rows') as HTMLElement);
    expect(rows.getByText('Modell')).toBeTruthy();
    expect(rows.getByText('Untergruppen')).toBeTruthy();
    expect(rows.queryByText('Stunden')).toBeNull();
    expect(rows.queryByText('Lehrkraft')).toBeNull();
  });
});

describe('Fachseite in „Raum“', () => {
  it('behält den bisherigen Kopf ohne meta-rows, zeigt die Chats aber nach Tagen gruppiert', async () => {
    document.documentElement.setAttribute('data-design', 'raum');
    const { server, subject } = setup();
    const { container } = mount(server, `/subjects/${subject.id}`);

    await screen.findByRole('heading', { level: 1, name: 'Beispielfach Lagen' });
    expect(container.querySelector('.lg-meta-rows')).toBeNull();
    expect(await screen.findByText('Beispielchat heute')).toBeTruthy();
    expect(container.querySelector('.lg-chats')).not.toBeNull();
    expect(screen.getByText('Heute')).toBeTruthy();
    expect(screen.getByText('Gestern')).toBeTruthy();
  });
});
