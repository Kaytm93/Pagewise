// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { ApiClient } from '../api/client';
import { pageKey } from '../router';
import { FakeServer } from '../test/fake-server';

/*
 * Rückweg aus dem Hefteintrags-Editor zur Liste (M4-T017): NotePage markiert den Rückweg im
 * sessionStorage, SubjectPage holt den Reiterbereich in den Blick und räumt einen Listenruf ab,
 * wenn das Panel der Hefteinträge nicht offen ist; die Liste nimmt den Fokus selbst. „Panel offen“
 * erkennt SubjectPage an einem Anker in der Liste (B-15, D-095), nicht mehr am übersetzten
 * aria-label. Das Verhalten ist dasselbe wie mit dem alten Selektor `[aria-label="Hefteinträge"]`.
 */

function setup() {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach A');
  const key = pageKey({ name: 'subject', subjectId: subject.id, groupId: null });
  return {
    server,
    subject,
    absprung: `pagewise.rueck.${key}`,
    listenRuf: `pagewise.ul-focus.${key}`,
  };
}

function open(server: FakeServer, path: string) {
  window.history.replaceState(null, '', path);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

let scrollIntoView: ReturnType<typeof vi.fn>;

/** Aufrufe auf Zielen im Seiteninhalt (main): Die Seitenleiste scrollt selbst und zählt hier nicht. */
function rufeImInhalt(): Element[] {
  return (scrollIntoView.mock.contexts as unknown as Element[]).filter((el) => el.closest('main'));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  // jsdom kennt scrollIntoView nicht.
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView'];
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

describe('Fachseite: Rückkehr zur Hefteintragsliste (M4-T017)', () => {
  it('holt den Reiterbereich in den Blick und gibt der Liste den Fokus, solange sie noch lädt', async () => {
    const { server, subject, absprung, listenRuf } = setup();
    server.addNote(subject.id, { title: 'Erster Eintrag' });
    window.sessionStorage.setItem(absprung, 'notes');
    window.sessionStorage.setItem(listenRuf, '1');

    open(server, `/subjects/${subject.id}/notes`);

    await screen.findByText('Erster Eintrag');
    const liste = document.getElementById('hefte-eintraege-liste');
    expect(liste).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(liste));
    // Der Ruf blieb bis zum Laden der Liste erhalten (das Panel galt als offen) und ist jetzt verbraucht.
    expect(window.sessionStorage.getItem(listenRuf)).toBeNull();
    expect(window.sessionStorage.getItem(absprung)).toBeNull();
    const bereich = document.getElementById('hefte-eintraege-bereich');
    expect(rufeImInhalt()).toContain(bereich);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('räumt einen verwaisten Listenruf ab, wenn der Reiter Chats offen ist', async () => {
    const { server, subject, absprung, listenRuf } = setup();
    window.sessionStorage.setItem(absprung, 'notes');
    window.sessionStorage.setItem(listenRuf, '1');

    open(server, `/subjects/${subject.id}`);

    await screen.findByRole('tablist', { name: 'Inhalt' });
    await waitFor(() => expect(window.sessionStorage.getItem(listenRuf)).toBeNull());
    expect(document.getElementById('hefte-eintraege-liste')).toBeNull();
    expect(window.sessionStorage.getItem(absprung)).toBeNull();
    expect(rufeImInhalt()).toContain(document.getElementById('hefte-eintraege-bereich'));
  });

  it('lässt den Listenruf stehen, wenn kein Rückweg markiert ist', async () => {
    const { server, subject, listenRuf } = setup();
    window.sessionStorage.setItem(listenRuf, '1');

    open(server, `/subjects/${subject.id}`);

    await screen.findByRole('tablist', { name: 'Inhalt' });
    expect(window.sessionStorage.getItem(listenRuf)).toBe('1');
    expect(rufeImInhalt()).toEqual([]);
  });

  it('gibt auch einer leeren Liste den Ruf nicht vor dem Laden ab', async () => {
    const { server, subject, absprung, listenRuf } = setup();
    window.sessionStorage.setItem(absprung, 'notes');
    window.sessionStorage.setItem(listenRuf, '1');

    open(server, `/subjects/${subject.id}/notes`);

    await screen.findByText('Noch keine Hefteinträge');
    // Verbraucht hat ihn die Liste (sie ist geladen), nicht die Fachseite beim ersten Zeichnen.
    await waitFor(() => expect(window.sessionStorage.getItem(listenRuf)).toBeNull());
    expect(screen.getByRole('region', { name: 'Hefteinträge' })).toBeTruthy();
  });
});
