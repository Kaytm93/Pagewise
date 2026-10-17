// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { ApiClient } from '../api/client';
import { FakeServer } from '../test/fake-server';

/*
 * F-073 (Befund shell-home#14): Die Schublade mountet die Seitenleiste bei jedem Öffnen neu — ein
 * lokaler Aufklapp-Zustand geht darum beim Schließen verloren. Zusätzlich trugen feste Leiste und
 * Schublade dieselben Panel-IDs (`groups-<Fach-ID>`), und `aria-controls` zeigte bei zugeklappten
 * Zeilen auf nicht vorhandene Elemente. Dieser Test nagt die Korrektur fest: Der Zustand bleibt
 * über das Schließen der Schublade hinaus, jedes `aria-controls` hat ein vorhandenes Ziel, und die
 * beiden Leisten teilen sich keine ID. (Der Abschnittstitel „Fächer“ mit der ID `subjects-heading`
 * liegt je Leiste und ist dort absichtlich gleich — er steuert nichts und gehört nicht zum Befund.)
 */

function mount(server: FakeServer) {
  window.history.replaceState(null, '', '/');
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

/**
 * Jedes `aria-controls` im Bereich hat ein vorhandenes Ziel, und die IDs im Bereich kommen darin
 * genau einmal vor — außer den je-Leiste-Abschnittstiteln (`subjects-heading`).
 */
function pruefeZieleUndIds(label: string, bereich: ParentNode): void {
  for (const steuernd of bereich.querySelectorAll('[aria-controls]')) {
    const ziel = steuernd.getAttribute('aria-controls') ?? '';
    expect(
      steuernd.ownerDocument.getElementById(ziel),
      `${label}: aria-controls-Ziel #${ziel} fehlt`,
    ).not.toBeNull();
  }
  const idAttrs = [...bereich.querySelectorAll('[id]')]
    .map((el) => el.id)
    .filter((id) => id !== 'subjects-heading');
  const doppelt = idAttrs.filter((id, index) => idAttrs.indexOf(id) !== index);
  expect(doppelt, `${label}: doppelte IDs (${JSON.stringify(doppelt)})`).toEqual([]);
}

const GRUPPEN_KNOPF = 'Beispielfach Chemie: Untergruppen ein- oder ausklappen';

async function drawerOeffnen(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Menü öffnen' }));
  return await screen.findByRole('dialog', { name: 'Navigation' });
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('Seitenleiste: Aufklapp-Zustand bleibt, IDs sind eindeutig (F-073)', () => {
  it('aufgeklappte Fächer bleiben aufgeklappt, wenn die Schublade zu- und wieder aufmacht', async () => {
    const server = new FakeServer('unlocked');
    const fach = server.addSubject('Beispielfach Chemie');
    server.addGroup(fach.id, 'Beispielgruppe Säuren');
    mount(server);
    const user = userEvent.setup();

    // Im Drawer aufklappen
    const schublade = await drawerOeffnen(user);
    const knopf = within(schublade).getByRole('button', { name: GRUPPEN_KNOPF });
    await user.click(knopf);
    expect(knopf.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(knopf.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(panel?.hasAttribute('hidden')).toBe(false);
    expect(
      within(panel as HTMLElement).getByRole('link', { name: 'Beispielgruppe Säuren' }),
    ).toBeTruthy();

    // Schließen (Escape) und wieder öffnen: noch aufgeklappt
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const schublade2 = await drawerOeffnen(user);
    const knopf2 = within(schublade2).getByRole('button', { name: GRUPPEN_KNOPF });
    expect(knopf2.getAttribute('aria-expanded')).toBe('true');
    const panel2 = document.getElementById(knopf2.getAttribute('aria-controls') ?? '');
    expect(panel2?.hasAttribute('hidden')).toBe(false);
    expect(
      within(panel2 as HTMLElement).getByRole('link', { name: 'Beispielgruppe Säuren' }),
    ).toBeTruthy();
    pruefeZieleUndIds('Schublade wieder geöffnet', schublade2);
  });

  it('Zuklappen im Drawer bleibt gemerkt, es gibt kein aria-controls ohne Ziel', async () => {
    const server = new FakeServer('unlocked');
    const fach = server.addSubject('Beispielfach Chemie');
    server.addGroup(fach.id, 'Beispielgruppe Säuren');
    mount(server);
    const user = userEvent.setup();

    // Drawer: einmal auf- und gleich wieder zuklappen
    const schublade = await drawerOeffnen(user);
    const knopf = within(schublade).getByRole('button', { name: GRUPPEN_KNOPF });
    await user.click(knopf);
    expect(knopf.getAttribute('aria-expanded')).toBe('true');
    await user.click(knopf);
    expect(knopf.getAttribute('aria-expanded')).toBe('false');
    // Gerade zugeklappt: das Ziel existiert trotzdem (vor der Korrektur: fehlte)
    const panelZu = document.getElementById(knopf.getAttribute('aria-controls') ?? '');
    expect(panelZu).not.toBeNull();
    expect(panelZu?.hasAttribute('hidden')).toBe(true);
    pruefeZieleUndIds('Schublade, zugeklappt', schublade);

    // Zu und wieder auf: bleibt zugeklappt (vor der Korrektur wäre es aufgeklappt gewesen)
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const schublade2 = await drawerOeffnen(user);
    const knopf2 = within(schublade2).getByRole('button', { name: GRUPPEN_KNOPF });
    expect(knopf2.getAttribute('aria-expanded')).toBe('false');
    const panel2 = document.getElementById(knopf2.getAttribute('aria-controls') ?? '');
    expect(panel2?.hasAttribute('hidden')).toBe(true);
  });

  it('feste Leiste und Schublade teilen sich keine ID mehr', async () => {
    const server = new FakeServer('unlocked');
    const fach = server.addSubject('Beispielfach Chemie');
    server.addGroup(fach.id, 'Beispielgruppe Säuren');
    mount(server);
    const user = userEvent.setup();

    // Feste Leiste (steht immer im DOM, auch wenn sie auf dem Handy verborgen ist)
    const feste = (await screen.findByRole('navigation', { name: 'Navigation' })) as HTMLElement;
    pruefeZieleUndIds('feste Leiste', feste);

    // Beide gleichzeitig: die Panels in fest und Schublade tragen verschiedene IDs
    await drawerOeffnen(user);
    const feste2 = document.querySelector('aside nav[aria-label="Navigation"]') as HTMLElement;
    const schublade = screen.getByRole('dialog', { name: 'Navigation' });
    const festePanels = [...feste2.querySelectorAll('ul[id]')].map((el) => el.id);
    const schubladenPanels = [...schublade.querySelectorAll('ul[id]')].map((el) => el.id);
    expect(festePanels.length).toBeGreaterThan(0);
    expect(schubladenPanels.length).toBe(festePanels.length);
    for (const id of festePanels) expect(schubladenPanels).not.toContain(id);
    pruefeZieleUndIds('Schublade', schublade);
    pruefeZieleUndIds('feste Leiste neben Schublade', feste2);
  });
});

/*
 * M1-T4: In „Lagen“ liegt ein einziger Streifen hinter dem aktiven Eintrag, statt dass jeder Eintrag
 * seinen eigenen Hintergrund mitbringt. jsdom hat kein Layout; dieser Abschnitt misst darum mit einer
 * festen Rechteck-Attrappe: Der Streifen hängt im Scrollbereich der Liste, ist dekorativ, übernimmt
 * Versatz und Maße des aktiven Eintrags, bleibt ohne aktiven Eintrag unsichtbar im DOM und existiert
 * in „Raum“, „Atelier“ und ohne Richtung gar nicht. Das Gleiten selbst (nur transform/opacity, kein
 * Layout-Sprung) gehört in den Echtbrowser.
 */

function rechteck(top: number, left: number, width: number, height: number): DOMRect {
  return {
    top,
    left,
    width,
    height,
    x: left,
    y: top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Layout-Attrappe: hohe Liste, „Start“ oben, das Fach darunter — alles andere ohne Fläche. */
function messeLayout(fach: string) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.classList.contains('lg-liste')) return rechteck(0, 0, 240, 480);
    if (this.classList.contains('lg-nav-item')) {
      const text = this.textContent ?? '';
      if (text.includes(fach)) return rechteck(120, 8, 156, 44);
      if (text.includes('Start')) return rechteck(10, 8, 200, 44);
    }
    return rechteck(0, 0, 0, 0);
  });
}

function richtung(design: 'lagen' | 'raum' | 'atelier' | null) {
  if (design) document.documentElement.setAttribute('data-design', design);
  else document.documentElement.removeAttribute('data-design');
}

function streifen(nav: HTMLElement): HTMLElement | null {
  return nav.querySelector<HTMLElement>('.lg-nav-marker');
}

describe('Seitenleiste in „Lagen“: ein Streifen hinter dem aktiven Eintrag (M1-T4)', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-design');
    vi.restoreAllMocks();
  });

  it('liegt als ein dekorativer Streifen im Scrollbereich der Liste', async () => {
    richtung('lagen');
    const server = new FakeServer('unlocked');
    server.addSubject('Beispielfach Chemie');
    mount(server);

    const nav = (await screen.findByRole('navigation', { name: 'Navigation' })) as HTMLElement;
    const marker = streifen(nav);
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute('aria-hidden')).toBe('true');
    expect(marker?.parentElement?.classList.contains('lg-liste')).toBe(true);
    expect(nav.querySelectorAll('.lg-nav-marker')).toHaveLength(1);
  });

  it('übernimmt Versatz, Höhe und Breite des aktiven Eintrags und folgt dem Wechsel', async () => {
    richtung('lagen');
    const server = new FakeServer('unlocked');
    const fach = server.addSubject('Beispielfach Chemie');
    messeLayout(fach.name);
    mount(server);
    const user = userEvent.setup();

    const nav = (await screen.findByRole('navigation', { name: 'Navigation' })) as HTMLElement;
    const marker = streifen(nav);
    expect(marker).not.toBeNull();
    await waitFor(() => expect(marker?.style.getPropertyValue('--lg-marker-y')).toBe('10px'));
    expect(marker?.style.getPropertyValue('--lg-marker-h')).toBe('44px');
    expect(marker?.style.getPropertyValue('--lg-marker-w')).toBe('200px');
    expect(marker?.style.getPropertyValue('--lg-marker-o')).toBe('1');

    // Wechsel auf das Fach: der Streifen zieht mit (Versatz und Breite des Eintrags).
    await user.click(within(nav).getByRole('link', { name: fach.name }));
    await waitFor(() =>
      expect(streifen(nav)?.style.getPropertyValue('--lg-marker-y')).toBe('120px'),
    );
    expect(streifen(nav)?.style.getPropertyValue('--lg-marker-w')).toBe('156px');
    expect(streifen(nav)?.style.getPropertyValue('--lg-marker-o')).toBe('1');
  });

  it('bleibt ohne aktiven Eintrag im DOM und unsichtbar', async () => {
    richtung('lagen');
    const server = new FakeServer('unlocked');
    server.addSubject('Beispielfach Chemie');
    messeLayout('Beispielfach Chemie');
    mount(server);
    const user = userEvent.setup();

    const nav = (await screen.findByRole('navigation', { name: 'Navigation' })) as HTMLElement;
    const marker = streifen(nav);
    expect(marker).not.toBeNull();

    // Einstellungen liegen in der festen Leiste unterhalb der Liste: kein aktiver Eintrag in der Liste.
    const einstellungen = within(nav).getAllByRole('link', { name: 'Einstellungen' });
    await user.click(einstellungen[einstellungen.length - 1] as HTMLElement);
    await waitFor(() => expect(marker?.style.getPropertyValue('--lg-marker-o')).toBe('0'));
    expect(streifen(nav)).toBe(marker);
  });

  it.each(['raum', 'atelier', null] as const)(
    'in %s gibt es keinen Streifen (Leiste unverändert)',
    async (design) => {
      richtung(design);
      const server = new FakeServer('unlocked');
      server.addSubject('Beispielfach Chemie');
      mount(server);

      const nav = (await screen.findByRole('navigation', { name: 'Navigation' })) as HTMLElement;
      expect(streifen(nav)).toBeNull();
    },
  );
});
