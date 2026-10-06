// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { ApiClient } from '../api/client';
import { FakeServer } from '../test/fake-server';

/*
 * Struktur des Dokuments (DoD M3-T031): Je Ansicht gibt es genau eine H1, sie ist die erste Überschrift
 * des Dokuments (im DOM liegt die Seitenleiste vor dem Inhalt; ihr Abschnittstitel „Fächer“ ist darum
 * ein Absatz, keine Überschrift), und es wird keine Ebene übersprungen. Der Chat-Teil des Befunds
 * (Nachrichten beginnen bei H3) gehört zu M4-T021 und bleibt hier außen vor.
 */

function mount(server: FakeServer, path: string) {
  window.history.replaceState(null, '', path);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

function ebenenFolge(levels: number[]): void {
  for (let i = 1; i < levels.length; i++) {
    const vorher = levels[i - 1];
    const aktuell = levels[i];
    if (vorher === undefined || aktuell === undefined) return;
    // Auf- und Abstieg um beliebig viele Stufen ist erlaubt; gesprungen wird nur beim Steigen.
    expect(aktuell - vorher).toBeLessThanOrEqual(1);
  }
}

async function pruefeStruktur(label: string): Promise<void> {
  const headings = await waitFor(() => {
    const found = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => ({
      tag: h.tagName.toLowerCase(),
      text: (h.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30),
    }));
    expect(found.length).toBeGreaterThan(0);
    return found;
  });
  const h1 = headings.filter((h) => h.tag === 'h1');
  expect(h1, `${label}: genau eine H1 (${JSON.stringify(headings)})`).toHaveLength(1);
  const erste = headings[0];
  expect(erste?.tag, `${label}: erste Überschrift ist die H1`).toBe('h1');
  ebenenFolge(headings.map((h) => Number(h.tag.charAt(1))));
}

beforeAll(async () => {
  await Promise.all([
    import('../screens/chat/ChatPage'),
    import('../screens/notes/NotePage'),
    import('../screens/chat/blocks/MathView'),
    import('../screens/chat/blocks/BlockView'),
  ]);
}, 30_000);

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('Überschriftenfolge: genau ein H1, H1 zuerst, keine übersprungene Ebene', () => {
  it('Startseite mit Fächern', async () => {
    const server = new FakeServer('unlocked');
    server.addSubject('Beispielfach A');
    mount(server, '/');
    await screen.findByRole('heading', { level: 1, name: 'Womit fangen wir an?' });
    await pruefeStruktur('Start');
  });

  it('Fachseite (Chats)', async () => {
    const server = new FakeServer('unlocked');
    const subject = server.addSubject('Beispielfach C');
    mount(server, `/subjects/${subject.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Beispielfach C' });
    await pruefeStruktur('Fach');
  });

  it('Notizen (Hefteintrag)', async () => {
    const server = new FakeServer('unlocked');
    const subject = server.addSubject('Beispielfach D');
    const note = server.addNote(subject.id, { title: 'Beispieleintrag', markdown: 'Ein Satz.' });
    mount(server, `/subjects/${subject.id}/notes/${note.id}`);
    await waitFor(() => {
      expect(document.querySelector('#note-title')).toBeTruthy();
    });
    await pruefeStruktur('Notiz');
  });

  it('Einstellungen', async () => {
    const server = new FakeServer('unlocked');
    server.addSubject('Beispielfach E');
    mount(server, '/settings');
    await screen.findByRole('heading', { level: 1, name: 'Einstellungen' });
    await pruefeStruktur('Einstellungen');
  });

  it('404', async () => {
    const server = new FakeServer('unlocked');
    server.addSubject('Beispielfach F');
    mount(server, '/gibt-es-nicht');
    await screen.findByRole('heading', { level: 1, name: 'Diese Seite gibt es nicht' });
    await pruefeStruktur('404');
  });

  it('die Seitenleiste trägt „Fächer“ als Absatz ohne Überschrift-Rolle', async () => {
    const server = new FakeServer('unlocked');
    server.addSubject('Beispielfach G');
    mount(server, '/');
    await screen.findByRole('heading', { level: 1, name: 'Womit fangen wir an?' });
    const label = document.querySelector('#subjects-heading');
    expect(label?.textContent).toBe('Fächer');
    expect(label?.getAttribute('role')).toBe('presentation');
  });
});

describe('Einrichtung als Startpunkt (H1 ohne Fächer)', () => {
  it('leerer Server: genau eine H1, keine übersprungene Ebene', async () => {
    const server = new FakeServer('setup');
    mount(server, '/');
    await screen.findByLabelText('Einrichtungscode');
    await pruefeStruktur('Einrichtung');
  });
});
