// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer } from './test/fake-server';
import { applyTheme, initTheme, readTheme, THEME_COLORS } from './ui/theme';

function openSettings() {
  window.history.replaceState(null, '', '/settings');
  return render(<App client={new ApiClient({ fetch: new FakeServer('unlocked').fetch })} />);
}

const levels = () =>
  [...document.documentElement.classList].filter((name) => name.startsWith('fx-'));

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-design');
});
afterEach(() => {
  window.localStorage.clear();
  document.documentElement.className = '';
  window.history.replaceState(null, '', '/');
});

describe('Einstellungen: Darstellung', () => {
  const bootSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'boot.js'),
    'utf8',
  );
  const indexSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'),
    'utf8',
  );
  const manifest = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'manifest.webmanifest'),
      'utf8',
    ),
  ) as {
    background_color: string;
    theme_color: string;
    color_scheme_dark?: { background_color: string; theme_color: string };
  };

  /** Inhalt der theme-color-Meta ohne media-Zweig (die, die das Skript setzt). */
  const meta = () =>
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
  const metaColor = () => meta()?.content;

  beforeEach(() => {
    if (!document.querySelector('meta[name="theme-color"]:not([media])')) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = THEME_COLORS.light;
      document.head.append(meta);
      const light = document.createElement('meta');
      light.name = 'theme-color';
      light.setAttribute('media', '(prefers-color-scheme: light)');
      light.content = THEME_COLORS.light;
      document.head.append(light);
      const dark = document.createElement('meta');
      dark.name = 'theme-color';
      dark.setAttribute('media', '(prefers-color-scheme: dark)');
      dark.content = THEME_COLORS.dark;
      document.head.append(dark);
    }
  });

  it('stellt die Bewegung um, merkt sich die Wahl und erklärt sie', async () => {
    openSettings();
    const user = userEvent.setup();
    const group = within(await screen.findByRole('group', { name: 'Bewegung' }));
    // Voreinstellung: folgt dem Gerät
    expect((group.getByRole('radio', { name: 'Automatisch' }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.getByText(/Folgt dem Gerät: wünscht es weniger Bewegung/)).toBeTruthy();

    await user.click(group.getByRole('radio', { name: 'Aus' }));
    expect(levels()).toEqual(['fx-off']);
    expect(window.localStorage.getItem('pagewise.fx')).toBe('off');
    expect(screen.getByText('Keine Bewegung.')).toBeTruthy();

    await user.click(group.getByRole('radio', { name: 'Voll' }));
    expect(levels()).toEqual(['fx-full']);
    expect(window.localStorage.getItem('pagewise.fx')).toBe('full');

    await user.click(group.getByRole('radio', { name: 'Automatisch' }));
    expect(window.localStorage.getItem('pagewise.fx')).toBeNull();
  });

  it('zeigt die gespeicherte Wahl beim Öffnen', async () => {
    window.localStorage.setItem('pagewise.fx', 'reduced');
    openSettings();
    const group = within(await screen.findByRole('group', { name: 'Bewegung' }));
    await waitFor(() =>
      expect((group.getByRole('radio', { name: 'Reduziert' }) as HTMLInputElement).checked).toBe(
        true,
      ),
    );
  });

  it('der Umschalter für hell und dunkel arbeitet weiter', async () => {
    openSettings();
    const user = userEvent.setup();
    const group = within(await screen.findByRole('group', { name: 'Darstellung' }));
    await user.click(group.getByRole('radio', { name: 'Dunkel' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('setzt die theme-color nach der gespeicherten Wahl, nicht nach dem Gerät', async () => {
    window.localStorage.setItem('pagewise.theme', 'dark');
    // So wie boot.js/main.tsx beim Start (jsdom startet die App nicht über main.tsx).
    applyTheme(readTheme());
    openSettings();
    const group = within(await screen.findByRole('group', { name: 'Darstellung' }));
    await waitFor(() =>
      expect((group.getByRole('radio', { name: 'Dunkel' }) as HTMLInputElement).checked).toBe(true),
    );
    expect(metaColor()).toBe(THEME_COLORS.dark);
    // Zurückschalten auf das Gerät (hier hell): die Leiste folgt der Oberfläche.
    await userEvent.setup().click(group.getByRole('radio', { name: 'Wie das Gerät' }));
    expect(metaColor()).toBe(THEME_COLORS.light);
  });

  it('wechselt die theme-color nur bei „system“ mit dem Gerät, wie applyTheme sie setzt', async () => {
    const user = userEvent.setup();
    let dark = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          get matches() {
            return query.includes('dark') ? dark : false;
          },
          addEventListener: (_: string, listener: () => void) => listeners.add(listener),
          removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
        }) as unknown as MediaQueryList,
    );
    // So wie main.tsx beim Start: initTheme meldet die Metas am Geräteschema an.
    const stop = initTheme();
    openSettings();
    const group = within(await screen.findByRole('group', { name: 'Darstellung' }));
    await waitFor(() =>
      expect(
        (group.getByRole('radio', { name: 'Wie das Gerät' }) as HTMLInputElement).checked,
      ).toBe(true),
    );
    expect(metaColor()).toBe(THEME_COLORS.light);
    dark = true;
    for (const listener of listeners) listener();
    expect(metaColor()).toBe(THEME_COLORS.dark);
    // Feste Wahl hell: am Geräteschema dreht sich nichts mehr.
    await user.click(group.getByRole('radio', { name: 'Hell' }));
    expect(metaColor()).toBe(THEME_COLORS.light);
    dark = false;
    for (const listener of listeners) listener();
    expect(metaColor()).toBe(THEME_COLORS.light);
    stop();
    vi.unstubAllGlobals();
  });

  it('nennt boot.js dieselben Flächenfarben wie theme.ts, index.html und das Manifest', () => {
    // Schlüssel/Werte-Vergleich wie in fx.test.ts: das Skript darf nicht neben dem Modul laufen.
    for (const value of Object.values(THEME_COLORS)) {
      expect(bootSource).toContain(`'${value}'`);
      expect(indexSource).toContain(`content="${value}"`);
    }
    expect(manifest.background_color).toBe(THEME_COLORS.light);
    expect(manifest.theme_color).toBe(THEME_COLORS.light);
    expect(manifest.color_scheme_dark).toEqual({
      background_color: THEME_COLORS.dark,
      theme_color: THEME_COLORS.dark,
    });
  });

  it('setzt die theme-color vor dem ersten Anstrich wie theme.ts', () => {
    const run = () => new Function(bootSource)();
    window.localStorage.setItem('pagewise.theme', 'dark');
    run();
    expect(metaColor()).toBe(THEME_COLORS.dark);
    // Ohne gespeicherte Wahl folgt die Leiste dem Gerät (im jsdom ohne Schema: hell).
    window.localStorage.removeItem('pagewise.theme');
    meta()?.setAttribute('content', '#000000');
    run();
    expect(metaColor()).toBe(THEME_COLORS.light);
  });

  it('wählt die Designrichtung, merkt sie sich und erklärt sie', async () => {
    openSettings();
    const user = userEvent.setup();
    const group = within(await screen.findByRole('group', { name: 'Designrichtung' }));
    // Voreinstellung: Raum
    expect((group.getByRole('radio', { name: 'Raum' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Ein Ordner mit Rücken und Heftung/)).toBeTruthy();

    await user.click(group.getByRole('radio', { name: 'Atelier' }));
    expect(document.documentElement.getAttribute('data-design')).toBe('atelier');
    expect(window.localStorage.getItem('pagewise.design')).toBe('atelier');
    expect(screen.getByText(/Klar und produktnah/)).toBeTruthy();

    await user.click(group.getByRole('radio', { name: 'Lagen' }));
    expect(document.documentElement.getAttribute('data-design')).toBe('lagen');
    expect(window.localStorage.getItem('pagewise.design')).toBe('lagen');
  });

  it('zeigt die gespeicherte Richtung beim Öffnen', async () => {
    window.localStorage.setItem('pagewise.design', 'lagen');
    openSettings();
    const group = within(await screen.findByRole('group', { name: 'Designrichtung' }));
    await waitFor(() =>
      expect((group.getByRole('radio', { name: 'Lagen' }) as HTMLInputElement).checked).toBe(true),
    );
  });
});
