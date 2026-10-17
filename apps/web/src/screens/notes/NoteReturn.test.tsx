// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { ApiClient } from '../../api/client';
import { FakeServer } from '../../test/fake-server';

/*
 * M4-T017: Rückweg aus dem Editor (Zurück-Link und Löschen) — die Fachseite holt den Reiter
 * „Hefteinträge“ in den Blick (scrollIntoView) und die Liste nimmt den Fokus. jsdom kann Bildlauf
 * und Sichtbarkeit nicht messen: der scrollIntoView-Aufruf wird per Spy genagelt, das Im-Blick-Sein
 * belegt die Browsermessung (pw/agents/m4-t017, Chromium + WebKit, iphone-hoch/ipad-hoch/mac,
 * alle Richtungen und Helligkeiten, vorher/nachher).
 */

const MODEL = { id: 'modell-a', vision: false, tools: false, reasoning: false, streaming: true };

function setup() {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach A');
  server.addNote(subject.id, { title: 'Erster Eintrag' });
  server.addNote(subject.id, { title: 'Zweiter Eintrag' });
  const provider = server.addProvider('Anbieter A', {
    models: [{ ...MODEL, free: false }],
    hasKey: true,
  });
  server.modelSettings = { default: { providerId: provider.id, model: 'modell-a' }, fallback: [] };
  return { server, subject };
}

function open(server: FakeServer, path: string) {
  window.history.replaceState(null, '', path);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

beforeAll(async () => {
  await Promise.all([
    import('../../screens/chat/ChatPage'),
    import('../../screens/notes/NotePage'),
  ]);
}, 30_000);

let scrollIntoView: ReturnType<typeof vi.fn>;

/**
 * Rufe auf Zielen im Seiteninhalt (main): Genau dort liegt das Ziel des Rückweg-Mechanismus der
 * Fachseite. Die Seitenleiste scrollt seit M4-T009 selbst zum aktiven Eintrag (außerhalb von main,
 * in der eigenen Liste) und darf diese Prüfung nicht berühren.
 */
function rueckrufeImInhalt(): Element[] {
  return (scrollIntoView.mock.contexts as unknown as Element[]).filter((el) => el.closest('main'));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView as unknown as (
    arg?: boolean | ScrollIntoViewOptions,
  ) => void;
});

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('Rückweg aus dem Editor: Liste im Blick (M4-T017)', () => {
  it('Zurück-Link: scrollIntoView aufs Ziel, Fokus auf der Liste', async () => {
    const { server, subject } = setup();
    const note = server.notes[0];
    expect(note).toBeTruthy();
    open(server, `/subjects/${subject.id}/notes/${note?.id}`);
    const user = userEvent.setup();
    await screen.findByRole('textbox', { name: 'Titel' });
    await user.click(screen.getByRole('link', { name: /Zurück zu den Hefteinträgen/ }));
    await screen.findByText('Erster Eintrag');
    expect(window.location.pathname).toBe(`/subjects/${subject.id}/notes`);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' }));
    expect(document.activeElement?.id).toBe('hefte-eintraege-liste');
    // Nur dieser Rückweg ruft: keine Markierung bleibt liegen
    const keys = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      keys.push(window.sessionStorage.key(i));
    }
    expect(keys.filter((k) => k?.startsWith('pagewise.'))).toEqual([]);
  });

  it('Löschen im Editor: scrollIntoView aufs Ziel, Fokus auf der Liste', async () => {
    const { server, subject } = setup();
    const note = server.notes[0];
    expect(note).toBeTruthy();
    open(server, `/subjects/${subject.id}/notes/${note?.id}`);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Löschen' });
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/subjects/${subject.id}/notes`));
    await screen.findByText('Zweiter Eintrag');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(document.activeElement?.id).toBe('hefte-eintraege-liste');
    expect(server.notes).toHaveLength(1);
  });

  it('anderes Zurück (Seitenleiste → Fach) ruft scrollIntoView nicht', async () => {
    const { server, subject } = setup();
    open(server, `/subjects/${subject.id}`);
    const user = userEvent.setup();
    await screen.findByRole('tablist', { name: 'Inhalt' });
    expect(rueckrufeImInhalt()).toEqual([]);
    await user.click(screen.getByRole('link', { name: 'Beispielfach A' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/subjects/${subject.id}`));
    expect(rueckrufeImInhalt()).toEqual([]);
    expect(document.activeElement?.id).not.toBe('hefte-eintraege-liste');
  });

  it('Hefteinträge direkt per Adresse: kein Fokus auf der Liste, kein scrollIntoView', async () => {
    const { server, subject } = setup();
    open(server, `/subjects/${subject.id}/notes`);
    await screen.findByText('Erster Eintrag');
    expect(rueckrufeImInhalt()).toEqual([]);
    expect(document.activeElement?.id).not.toBe('hefte-eintraege-liste');
  });
});
