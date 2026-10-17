// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { ApiClient } from '../api/client';
import { FakeServer } from '../test/fake-server';

/*
 * Befund shell-home#09: Im Querformat (Fensterhöhe < 500 px) bleibt für die Fächerliste zu wenig
 * Platz — Kopf und Fuß fressen die Liste — und die Leiste scrollt nie zum aktiven Eintrag (auf dem
 * Mac mit 10 Fächern liegt das letzte Fach hinter dem Rand). Diese Datei nagt fest, was jsdom tragen
 * kann: Der Bildlauf selbst gehört dem Browser (jsdom hat kein Layout) und wird in Echtbrowsern
 * gemessen (shots/M4-T009/).
 *
 * Nach Muster NoteReturn.test.tsx: jsdom kennt scrollIntoView nicht, darum Spy auf dem Prototyp.
 * Es gibt hier absichtlich kein `any`: der Umweg über die Struktur hält den Typen vollständig.
 */

type ScrollIntoViewMock = ReturnType<typeof vi.fn>;

let scrollIntoView: ScrollIntoViewMock;

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView =
    scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mount(server: FakeServer) {
  window.history.replaceState(null, '', '/');
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

/** Feste Leiste (der Fachname steht auch auf dem Startblatt, darum immer in der Leiste suchen). */
function leiste() {
  const nav = document.querySelector('aside nav[aria-label="Navigation"]');
  expect(nav).not.toBeNull();
  return nav as HTMLElement;
}

describe('Seitenleiste: Bildlauf zum aktiven Eintrag (shell-home#09)', () => {
  it('Navigation zum Fach ruft scrollIntoView({block:"nearest"}) auf dem aktiven Eintrag auf', async () => {
    const server = new FakeServer('unlocked');
    const fach = server.addSubject('Beispielfach Chemie');
    mount(server);
    const user = userEvent.setup();

    await screen.findByText('Fächer');
    await user.click(within(leiste()).getByRole('link', { name: fach.name }));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

    // Gerufen wird am aktiven Eintrag selbst (aria-current=page bzw. seiner Zeile), nicht an
    // irgendeinem Element.
    const aktuelleZeilen = [...document.querySelectorAll('a[aria-current="page"]')]
      .filter((a) => (a.textContent ?? '').includes(fach.name))
      .map((a) => a.closest('li'));
    expect(aktuelleZeilen.length).toBeGreaterThan(0);
    const gerufen = scrollIntoView.mock.contexts as unknown as Element[];
    expect(gerufen.some((el) => aktuelleZeilen.includes(el as HTMLLIElement))).toBe(true);
  });

  it('Wechsel zwischen zwei Fächern scrollt genau einmal (kein Aufruf bei gleichem Eintrag)', async () => {
    const server = new FakeServer('unlocked');
    const a = server.addSubject('Beispielfach Chemie');
    const b = server.addSubject('Beispielfach Physik');
    mount(server);
    const user = userEvent.setup();

    await screen.findByText('Fächer');
    await user.click(within(leiste()).getByRole('link', { name: a.name }));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    const after = scrollIntoView.mock.calls.length;

    await user.click(within(leiste()).getByRole('link', { name: b.name }));
    await waitFor(() => expect(scrollIntoView.mock.calls.length).toBeGreaterThan(after));
    // Streng ein Aufruf pro aktivem Wechsel: rendern allein ruft nicht.
    await waitFor(() => expect(scrollIntoView.mock.calls.length).toBe(after + 1));
  });

  it('Öffnen der Schublade übernimmt die Position nicht: jede Leiste ruft selbst und nur bei Wechsel', async () => {
    const server = new FakeServer('unlocked');
    const fach = server.addSubject('Beispielfach Chemie');
    mount(server);
    const user = userEvent.setup();
    await screen.findByText('Fächer');
    await user.click(within(leiste()).getByRole('link', { name: fach.name }));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    const festeRufe = scrollIntoView.mock.calls.length;

    // Schublade auf: die zweite Leiste holt denselben aktiven Eintrag nach („sobald die Instanz ihn
    // sieht“); die feste Leiste wird dabei nicht erneut angerufen (ihr Schlüssel ändert sich nicht).
    await user.click(await screen.findByRole('button', { name: 'Menü öffnen' }));
    const schublade = await screen.findByRole('dialog', { name: 'Navigation' });
    await waitFor(() => expect(scrollIntoView.mock.calls.length).toBeGreaterThan(festeRufe));
    const gerufen = scrollIntoView.mock.contexts as unknown as Element[];
    const inSchublade = [...schublade.querySelectorAll('a[aria-current="page"]')].filter((a) =>
      (a.textContent ?? '').includes(fach.name),
    );
    expect(inSchublade.length).toBeGreaterThan(0);
    const ziel = inSchublade[0];
    if (ziel) expect(gerufen.includes(ziel.closest('li') as HTMLLIElement)).toBe(true);
  });
});
