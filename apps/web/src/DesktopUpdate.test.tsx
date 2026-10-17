// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer } from './test/fake-server';
import { DESKTOP_UPDATE_PATH, isDesktopApp } from './ui/desktop-app';

const ELECTRON_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Pagewise/0.0.0 Chrome/140.0.0.0 Electron/44.7.0 Safari/537.36';

const originalUserAgent = navigator.userAgent;
const setUserAgent = (userAgent: string) =>
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });

/** Öffnet die Einstellungen. Die Adresse steht vor dem Austauschen von `location`, sonst liest die Oberfläche die alte. */
function openSettings(stubs: () => void = () => undefined) {
  window.history.replaceState(null, '', '/settings');
  stubs();
  return render(<App client={new ApiClient({ fetch: new FakeServer('unlocked').fetch })} />);
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  setUserAgent(originalUserAgent);
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('Einstellungen: Pagewise-App und Updates (D-057)', () => {
  it('erkennt die Mac-App am Electron-Eintrag des Browsers', () => {
    expect(isDesktopApp(ELECTRON_UA)).toBe(true);
    expect(
      isDesktopApp('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1'),
    ).toBe(false);
    expect(isDesktopApp('Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36')).toBe(false);
  });

  it('zeigt in einem normalen Browser keinen Abschnitt für die App', async () => {
    openSettings();
    await screen.findByRole('heading', { name: 'Einstellungen', level: 1 });
    expect(screen.queryByRole('heading', { name: 'Pagewise-App' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Nach Updates suchen/ })).toBeNull();
  });

  it('zeigt in der Mac-App den Knopf, der die Adresse der Hülle ansteuert', async () => {
    const assign = vi.fn();
    openSettings(() => {
      setUserAgent(ELECTRON_UA);
      vi.stubGlobal('location', { ...window.location, assign });
    });
    expect(await screen.findByRole('heading', { name: 'Pagewise-App', level: 2 })).toBeTruthy();
    expect(screen.getByText(/Es passiert nichts ohne deinen Klick/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Nach Updates suchen …' }));
    expect(assign).toHaveBeenCalledWith(DESKTOP_UPDATE_PATH);
    expect(DESKTOP_UPDATE_PATH).toBe('/__pagewise/update');
  });
});
