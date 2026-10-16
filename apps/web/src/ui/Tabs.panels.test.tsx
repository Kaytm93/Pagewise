// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { ApiClient } from '../api/client';
import { FakeServer } from '../test/fake-server';

/*
 * M4-T038 (Rest aus M4-T025, Beleg bericht-m4-t025.md „Restfund“): Jeder Reiter-Knopf der Fachseite
 * trug `aria-controls="…-panel"`, aber nur das Panel des gewählten Reiters lag im Baum — bei
 * „Hefteinträge“ zeigte das Attribut ins Leere. Dieser Test nagt die Korrektur fest: Alle Panels
 * sind dauerhaft vorhanden (zugeklappt per hidden), jedes `aria-controls` hat ein Ziel, und alle
 * IDs im Panels-Bereich kommen genau einmal vor.
 */

function setup() {
  const server = new FakeServer('unlocked');
  const subject = server.addSubject('Beispielfach A');
  server.addGroup(subject.id, 'Beispiel-Gruppe');
  return { server, subject };
}

function mount(server: FakeServer, path: string) {
  window.history.replaceState(null, '', path);
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

describe('Fachseite: Reiter-Panels haben dauerhafte, eindeutige IDs (M4-T038)', () => {
  it('gibt jedem Reiter ein vorhandenes Panel — auch dem nicht gewählten', async () => {
    const { server, subject } = setup();
    mount(server, `/subjects/${subject.id}`);
    const user = userEvent.setup();
    const tabs = await screen.findByRole('tablist', { name: 'Inhalt' });

    const pruefeKette = () => {
      for (const knopf of within(tabs).getAllByRole('tab')) {
        const ziel = knopf.getAttribute('aria-controls') ?? '';
        expect(ziel, 'Reiter-Knopf trägt aria-controls').not.toBe('');
        expect(
          knopf.ownerDocument.getElementById(ziel),
          `aria-controls-Ziel #${ziel} fehlt`,
        ).not.toBeNull();
      }
    };
    pruefeKette();

    // Auch nach dem Wechsel auf „Hefteinträge“ (und zurück) bleibt die Kette ganz.
    await user.click(within(tabs).getByRole('tab', { name: 'Hefteinträge' }));
    pruefeKette();
    await user.click(within(tabs).getByRole('tab', { name: 'Chats' }));
    pruefeKette();
  });

  it('zeigt das gewählte Panel und versteckt die anderen per hidden statt sie zu entfernen', async () => {
    const { server, subject } = setup();
    mount(server, `/subjects/${subject.id}`);
    const user = userEvent.setup();
    const tabs = await screen.findByRole('tablist', { name: 'Inhalt' });
    const chats = within(tabs).getByRole('tab', { name: 'Chats' });
    const notes = within(tabs).getByRole('tab', { name: 'Hefteinträge' });
    const panelOf = (knopf: HTMLElement) =>
      knopf.ownerDocument.getElementById(knopf.getAttribute('aria-controls') ?? '');

    expect(chats.getAttribute('aria-selected')).toBe('true');
    expect(panelOf(chats)?.hidden).toBe(false);
    expect(panelOf(notes)?.hidden).toBe(true);

    await user.click(notes);
    expect(chats.getAttribute('aria-selected')).toBe('false');
    expect(panelOf(chats)?.hidden).toBe(true);
    expect(panelOf(notes)?.hidden).toBe(false);
    // Inhalt des gewählten Panels: die Hefteinträge-Suche sitzt im sichtbaren Panel.
    expect(panelOf(notes)?.querySelector('input[type="search"]')).not.toBeNull();
  });

  it('vergibt im Panels-Bereich keine doppelten IDs', async () => {
    const { server, subject } = setup();
    mount(server, `/subjects/${subject.id}`);
    const tabs = await screen.findByRole('tablist', { name: 'Inhalt' });
    const panelIds = [...document.querySelectorAll('[role="tabpanel"]')].map((el) => el.id);
    expect(panelIds.length).toBeGreaterThanOrEqual(2);
    const doppelt = panelIds.filter((id, index) => panelIds.indexOf(id) !== index);
    expect(doppelt, `doppelte Panel-IDs (${JSON.stringify(doppelt)})`).toEqual([]);
    // Reiter- und Panel-IDs nutzen gemeinsam den useId-Namensraum: ein Reiter pro Panel-ID.
    for (const knopf of within(tabs).getAllByRole('tab')) {
      expect(panelIds).toContain(knopf.getAttribute('aria-controls'));
    }
  });
});
