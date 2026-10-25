// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { ApiClient } from '../../api/client';
import { FakeServer } from '../../test/fake-server';

/*
 * Die Fachseite als „Arbeitsplatz“ in „Atelier“: Kopf mit Motiv, Ledger, Untergruppen als Kacheln, die zugleich
 * Filter sind (echte Schalter mit Tastatur), danach Chats und Hefteinträge. „Raum“, „Lagen“ und die Seite einer
 * Untergruppe behalten ihren Aufbau. Alle Namen und Daten sind erfunden.
 */

const NOW = new Date(2026, 9, 5, 10, 0, 0);

function setup() {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach Atelier', {
    teacher: 'Beispielkraft',
    hoursPerWeek: 3,
    icon: 'flask',
    color: 0,
  });
  const eins = server.addGroup(subject.id, 'Beispielgruppe Eins');
  const zwei = server.addGroup(subject.id, 'Beispielgruppe Zwei');
  server.addChat(subject.id, { title: 'Beispielchat im Fach', updatedAt: NOW.getTime() });
  server.addChat(subject.id, {
    title: 'Beispielchat Gruppe Eins',
    groupId: eins.id,
    updatedAt: NOW.getTime(),
  });
  server.addExam(subject.id, { kind: 'Schulaufgabe', date: '2026-10-08' });
  const provider = server.addProvider('Anbieter A', {
    models: [
      {
        id: 'modell-a',
        vision: false,
        tools: true,
        reasoning: false,
        streaming: true,
        free: false,
      },
    ],
    hasKey: true,
  });
  server.modelSettings = { default: { providerId: provider.id, model: 'modell-a' }, fallback: [] };
  return { server, subject, eins, zwei };
}

function mount(server: FakeServer, path: string, design?: 'raum' | 'lagen' | 'atelier') {
  if (design) document.documentElement.setAttribute('data-design', design);
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
  window.history.replaceState(null, '', '/');
});

describe('Fachseite in „Atelier“ (Arbeitsplatz)', () => {
  it('zeigt Kopf mit gezeichnetem Motiv und Fläche, ohne Inline-Styles', async () => {
    const { server, subject } = setup();
    const { container } = mount(server, `/subjects/${subject.id}`, 'atelier');
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Beispielfach Atelier' });

    // Die Größe kommt aus dem Token, lange Namen trennt die Silbentrennung.
    expect(h1.className).toContain('text-[length:var(--subject-h1)]');
    expect(h1.className).toContain('hyphens-auto');
    expect(h1.getAttribute('lang')).toBe('de');

    const head = container.querySelector('.at-head') as HTMLElement;
    const motif = head.querySelector('.at-motif') as SVGElement;
    expect(motif.getAttribute('data-motif')).toBe('flask');
    expect(motif.getAttribute('aria-hidden')).toBe('true');
    // Drei Linien zum Zeichnen (pathLength=1) und für den Kolben eine blasse Fläche dahinter.
    expect(motif.querySelectorAll('.lg-motif-stroke[pathLength="1"]')).toHaveLength(3);
    expect(motif.querySelectorAll('.lg-motif-fill')).toHaveLength(1);
    expect(container.querySelector('[style]')).toBeNull();
    expect(container.querySelector('style')).toBeNull();
  });

  it('zeigt im Ledger Modell, Untergruppen und den nächsten Test', async () => {
    const { server, subject } = setup();
    mount(server, `/subjects/${subject.id}`, 'atelier');
    const table = await screen.findByLabelText('Kennzahlen des Fachs');
    const rows = within(table);
    expect(rows.getByText('Modell')).toBeTruthy();
    expect(rows.getByText('Standardmodell: Anbieter A · modell-a')).toBeTruthy();
    expect(rows.getByText('Untergruppen')).toBeTruthy();
    expect(rows.getByText('2 Untergruppen')).toBeTruthy();
    // Der Test erscheint, sobald der Planer geladen ist: Datum, Art und Abstand zu heute.
    await waitFor(() => expect(rows.getByText('Nächster Test')).toBeTruthy());
    expect(rows.getByText('Schulaufgabe')).toBeTruthy();
    expect(rows.getByText(/in 3 Tagen/)).toBeTruthy();
    // Ohne Zählung des Servers gibt es keine Zeilen für Chats und Hefteinträge.
    expect(rows.queryByText('Chats')).toBeNull();
    expect(rows.queryByText('Hefteinträge')).toBeNull();
  });

  it('sagt im Ledger „Kein Test eingetragen“, wenn keiner ansteht', async () => {
    const { server, subject } = setup();
    server.exams.length = 0;
    mount(server, `/subjects/${subject.id}`, 'atelier');
    const table = await screen.findByLabelText('Kennzahlen des Fachs');
    await waitFor(() => expect(within(table).getByText('Kein Test eingetragen')).toBeTruthy());
  });

  it('macht aus den Untergruppen Schalter: per Tastatur filtern und wieder aufheben', async () => {
    const { server, subject, eins } = setup();
    const user = userEvent.setup({ advanceTimers: () => undefined });
    mount(server, `/subjects/${subject.id}`, 'atelier');

    const tiles = await screen.findByRole('list', { name: 'Untergruppe als Filter' });
    const kachel = within(tiles).getByRole('button', { name: 'Beispielgruppe Eins' });
    expect(kachel.getAttribute('aria-pressed')).toBe('false');
    expect(tiles.querySelectorAll('li')).toHaveLength(2);

    // Ohne Filter stehen die Chats des Fachs selbst da.
    await screen.findByText('Beispielchat im Fach');
    expect(screen.queryByText('Beispielchat Gruppe Eins')).toBeNull();

    kachel.focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(
        within(tiles)
          .getByRole('button', { name: 'Beispielgruppe Eins' })
          .getAttribute('aria-pressed'),
      ).toBe('true'),
    );
    await screen.findByText('Beispielchat Gruppe Eins');
    expect(screen.queryByText('Beispielchat im Fach')).toBeNull();
    expect(screen.getByText('Zeigt nur: Beispielgruppe Eins')).toBeTruthy();
    // Der Zustand ist nicht nur Farbe: die Kachel nennt „Filter aktiv“.
    expect(kachel.textContent).toContain('Filter aktiv');
    // Der Filter nutzt die vorhandene Abfrage der Untergruppe, keine neue.
    expect(
      server.requests.some(
        (r) => r.path.startsWith('/api/chats?') && r.path.includes(`groupId=${eins.id}`),
      ),
    ).toBe(true);

    // Noch einmal mit der Leertaste wählen hebt den Filter auf.
    kachel.focus();
    await user.keyboard(' ');
    await screen.findByText('Beispielchat im Fach');
    expect(kachel.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText(/Zeigt nur/)).toBeNull();
  });

  it('hebt den Filter auch mit dem Knopf über der Liste auf', async () => {
    const { server, subject } = setup();
    const user = userEvent.setup({ advanceTimers: () => undefined });
    mount(server, `/subjects/${subject.id}`, 'atelier');
    const kachel = await screen.findByRole('button', { name: 'Beispielgruppe Zwei' });
    await user.click(kachel);
    const clear = await screen.findByRole('button', { name: 'Filter aufheben' });
    await user.click(clear);
    await screen.findByText('Beispielchat im Fach');
    expect(screen.queryByRole('button', { name: 'Filter aufheben' })).toBeNull();
  });

  it('lässt „Öffnen“ und „Bearbeiten“ je Untergruppe bestehen, jede Fläche mindestens 44 px', async () => {
    const { server, subject, eins } = setup();
    mount(server, `/subjects/${subject.id}`, 'atelier');
    const open = await screen.findByRole('link', {
      name: 'Untergruppe „Beispielgruppe Eins“ öffnen',
    });
    expect(open.getAttribute('href')).toBe(`/subjects/${subject.id}/groups/${eins.id}`);
    expect(
      screen.getByRole('button', { name: 'Untergruppe „Beispielgruppe Eins“ bearbeiten' }),
    ).toBeTruthy();
  });

  it('stellt die Arbeit voran: Chats und Hefteinträge stehen vor Prompt und Modell', async () => {
    const { server, subject } = setup();
    mount(server, `/subjects/${subject.id}`, 'atelier');
    await screen.findByRole('heading', { level: 1, name: 'Beispielfach Atelier' });
    const arbeit = document.getElementById('hefte-eintraege-bereich') as HTMLElement;
    const prompt = document.getElementById('prompt-heading') as HTMLElement;
    expect(arbeit.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('behält auf der Seite einer Untergruppe den gemeinsamen Aufbau', async () => {
    const { server, subject, eins } = setup();
    const { container } = mount(server, `/subjects/${subject.id}/groups/${eins.id}`, 'atelier');
    await screen.findByRole('heading', { level: 1, name: 'Beispielgruppe Eins' });
    expect(container.querySelector('.at-ledger')).toBeNull();
    expect(container.querySelector('.at-tiles')).toBeNull();
    expect(container.querySelector('.at-head')).toBeNull();
  });
});

describe.each([
  ['Raum', 'raum'],
  ['Lagen', 'lagen'],
  ['ohne Richtung', undefined],
] as const)('Fachseite in %s', (_name, design) => {
  it('hat weder Ledger noch Kacheln und behält die Liste der Untergruppen', async () => {
    const { server, subject } = setup();
    const { container } = mount(server, `/subjects/${subject.id}`, design);
    await screen.findByRole('heading', { level: 1, name: 'Beispielfach Atelier' });
    expect(container.querySelector('.at-ledger, .at-tiles, .at-head')).toBeNull();
    const liste = (document.getElementById('groups-heading') as HTMLElement).closest(
      'section',
    ) as HTMLElement;
    expect(within(liste).getByRole('link', { name: /Beispielgruppe Eins/ })).toBeTruthy();
    expect(within(liste).queryByRole('button', { pressed: false })).toBeNull();
    // Prompt und Modell stehen wie bisher vor Chats und Hefteinträgen.
    const arbeit = document.getElementById('hefte-eintraege-bereich') as HTMLElement;
    const prompt = document.getElementById('prompt-heading') as HTMLElement;
    expect(prompt.compareDocumentPosition(arbeit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
