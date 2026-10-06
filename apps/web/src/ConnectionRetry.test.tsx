// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { ConnectionScreen } from './screens/ConnectionScreen';
import { FakeServer } from './test/fake-server';

function mount(server: FakeServer) {
  return render(
    <App client={new ApiClient({ fetch: (input, init) => server.fetch(input, init) })} />,
  );
}

afterEach(() => vi.useRealTimers());

describe('Verbindung: „Erneut versuchen“ behält den Fokus, ohne zu flackern', () => {
  it('lässt beim Scheitern den Knopf im Baum und den Fokus auf ihm', async () => {
    const server = new FakeServer('unlocked');
    server.unreachable = true;
    mount(server);
    const retry = (await screen.findByRole('button', {
      name: 'Erneut versuchen',
    })) as HTMLButtonElement;
    retry.focus();
    expect(document.activeElement).toBe(retry);

    const user = userEvent.setup();
    await user.click(retry);
    // Scheitert die Prüfung sofort, bleibt der Knopf derselbe: Fokus und Baum bleiben.
    await screen.findByRole('button', { name: 'Erneut versuchen' });
    expect(document.activeElement).toBe(retry);
    expect(retry.isConnected).toBe(true);
  });

  it('tauscht bei kurzer Prüfung nichts aus: derselbe Knopf, keine Ladeanzeige mehr als nötig', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = new FakeServer('unlocked');
    server.unreachable = true;
    mount(server);
    const retry = (await screen.findByRole('button', {
      name: 'Erneut versuchen',
    })) as HTMLButtonElement;
    retry.focus();

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = server.fetch;
    server.fetch = async (input, init) => {
      await gate;
      return base(input, init);
    };

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(retry);
    // Derselbe Knopf bleibt im Baum, im Fokus und bedienbar; die Prüfung zeigt er erst nach
    // kurzer Frist, damit ein schneller Fehlversuch nicht flackert.
    await waitFor(() => expect(retry.getAttribute('aria-busy')).toBe('true'));
    expect(retry.isConnected).toBe(true);
    expect(document.activeElement).toBe(retry);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByRole('button', { name: 'Verbindung wird geprüft …' })).toBe(retry);
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(retry);

    release();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Scheitert der Versuch, kehrt der Fokus zum Knopf zurück.
    await screen.findByRole('button', { name: 'Erneut versuchen' });
    expect(document.activeElement).toBe(retry);
  });

  it('erledigt die Rückkehr in denselben Knopf auch, wenn die Prüfung unmittelbar scheitert', async () => {
    const server = new FakeServer('unlocked');
    server.unreachable = true;
    mount(server);
    const retry = (await screen.findByRole('button', {
      name: 'Erneut versuchen',
    })) as HTMLButtonElement;
    retry.focus();

    const user = userEvent.setup();
    await user.click(retry);
    await screen.findByRole('button', { name: 'Erneut versuchen' });
    expect(document.activeElement).toBe(retry);
    expect(screen.queryByText('Verbindung wird geprüft …')).toBeNull();
  });

  it('setzt den Fokus beim Rückwechsel von „lädt“ zu „nicht erreichbar“ auf den Knopf', () => {
    const { rerender } = render(<ConnectionScreen state="loading" onRetry={() => {}} />);
    rerender(<ConnectionScreen state="unreachable" onRetry={() => {}} />);
    const retry = screen.getByRole('button', { name: 'Erneut versuchen' });
    expect(document.activeElement).toBe(retry);
  });
});
