// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer } from './test/fake-server';

function mount(server: FakeServer) {
  // Über die Eigenschaft, damit ein Test `server.fetch` später ersetzen kann.
  return render(
    <App client={new ApiClient({ fetch: (input, init) => server.fetch(input, init) })} />,
  );
}

const BANNER = 'Mac nicht erreichbar. Schläft er, oder ist Tailscale getrennt?';

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

describe('Verbindungs-Banner (Mac nicht erreichbar)', () => {
  it('erscheint nicht blockierend, lässt die Ansicht stehen und verschwindet beim Erneut-Versuchen', async () => {
    const server = new FakeServer('unlocked');
    mount(server);
    const heading = await screen.findByRole('heading', { name: 'Noch keine Fächer' });
    expect(screen.queryByTestId('connection-banner')).toBeNull();

    // Der Mac schläft: die Probe schlägt fehl, wenn die Seite wieder sichtbar wird.
    server.unreachable = true;
    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });
    const banner = await screen.findByTestId('connection-banner');
    expect(banner.textContent).toContain(BANNER);
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');
    // Die geladene Ansicht bleibt, nichts wird durch ein Vollbild ersetzt.
    expect(screen.getByRole('heading', { name: 'Noch keine Fächer' })).toBe(heading);

    // Der Mac ist zurück: „Erneut versuchen“, Banner weg, Sitzung und Arbeitsbereich werden neu geholt.
    const sessionCalls = server.calls('GET', '/api/session').length;
    const subjectCalls = server.calls('GET', '/api/subjects').length;
    server.unreachable = false;
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(screen.queryByTestId('connection-banner')).toBeNull());
    await waitFor(() => {
      expect(server.calls('GET', '/api/session').length).toBeGreaterThan(sessionCalls);
      expect(server.calls('GET', '/api/subjects').length).toBeGreaterThan(subjectCalls);
    });
    // Es war kein Neuaufbau: dasselbe Element, Entwürfe in der Ansicht blieben.
    expect(screen.getByRole('heading', { name: 'Noch keine Fächer' })).toBe(heading);
  });

  it('zeigt „Prüfe …“, solange die Probe läuft, und sperrt dann den Knopf', async () => {
    const server = new FakeServer('unlocked');
    mount(server);
    await screen.findByRole('heading', { name: 'Noch keine Fächer' });
    server.unreachable = true;
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    await screen.findByTestId('connection-banner');

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = server.fetch;
    server.fetch = async (input, init) => {
      await gate;
      return base(input, init);
    };
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    const busy = await screen.findByRole('button', { name: 'Prüfe …' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeTruthy(),
    );
  });

  it('übernimmt Änderungen vom Server nach der Rückkehr, ohne die Ansicht zu verlassen', async () => {
    const server = new FakeServer('unlocked');
    mount(server);
    const heading = await screen.findByRole('heading', { name: 'Noch keine Fächer' });

    server.unreachable = true;
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    await screen.findByTestId('connection-banner');
    // Während des Ausfalls (z. B. am Mac) kommt ein Fach dazu.
    server.addSubject('Beispielfach A');
    server.unreachable = false;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(screen.queryByTestId('connection-banner')).toBeNull());
    expect((await screen.findAllByText('Beispielfach A')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Noch keine Fächer' })).toBeNull();
    expect(heading.isConnected).toBe(false);
  });

  it('zeigt beim ersten Laden nur den Vollbild-Hinweis und lädt von selbst, sobald der Mac antwortet', async () => {
    const server = new FakeServer('unlocked');
    server.unreachable = true;
    mount(server);
    expect(
      await screen.findByRole('heading', { name: 'Der Server antwortet nicht.' }),
    ).toBeTruthy();
    expect(screen.queryByTestId('connection-banner')).toBeNull();

    server.unreachable = false;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(await screen.findByRole('heading', { name: 'Noch keine Fächer' })).toBeTruthy();
    expect(screen.queryByTestId('connection-banner')).toBeNull();
  });

  describe('Mac lässt die Verbindung hängen (schläft bei verbundenem Tailscale)', () => {
    afterEach(() => vi.useRealTimers());

    /** `fetch`, das für die genannten Pfade nie antwortet, solange `hang.on` gilt. */
    function hanging(server: FakeServer, paths: string[]) {
      const hang = { on: true, requested: [] as string[] };
      const base = server.fetch;
      server.fetch = (input, init) => {
        if (hang.on && paths.includes(String(input))) {
          hang.requested.push(String(input));
          return new Promise<Response>(() => {});
        }
        return base(input, init);
      };
      return hang;
    }

    it('zeigt nach 8 Sekunden „Der Server antwortet nicht.“ statt ewig zu laden, und lädt nach „Erneut versuchen“', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const server = new FakeServer('unlocked');
      const hang = hanging(server, ['/api/session']);
      mount(server);
      expect(await screen.findByText('Verbindung wird geprüft …')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(7_999);
      expect(screen.queryByRole('heading', { name: 'Der Server antwortet nicht.' })).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(
        await screen.findByRole('heading', { name: 'Der Server antwortet nicht.' }),
      ).toBeTruthy();

      hang.on = false;
      await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
      expect(await screen.findByRole('heading', { name: 'Noch keine Fächer' })).toBeTruthy();
    });

    it('zeigt dasselbe, wenn erst das Laden der Fächer hängt', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const server = new FakeServer('unlocked');
      const hang = hanging(server, ['/api/profile']);
      mount(server);
      // Erst wenn die Sitzung steht, beginnt das Laden der Fächer (und mit ihm sein Zeitlimit).
      await vi.waitFor(() => expect(hang.requested).toContain('/api/profile'));
      await vi.advanceTimersByTimeAsync(8_000);
      expect(
        await screen.findByRole('heading', { name: 'Der Server antwortet nicht.' }),
      ).toBeTruthy();
      hang.on = false;
      await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
      expect(await screen.findByRole('heading', { name: 'Noch keine Fächer' })).toBeTruthy();
    });
  });
});
