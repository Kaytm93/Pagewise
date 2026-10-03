// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Broken({ message }: { message: string }): never {
  throw new Error(message);
}

afterEach(() => vi.restoreAllMocks());

describe('ErrorBoundary', () => {
  it('zeigt die Kinder, solange alles läuft', () => {
    render(
      <ErrorBoundary resetKey="a">
        <p>Alles gut</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Alles gut')).toBeTruthy();
  });

  it('erklärt nach einem Update, dass ein Teil fehlt, und bietet Neuladen an', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    try {
      render(
        <ErrorBoundary resetKey="a">
          <Broken message="Failed to fetch dynamically imported module: /assets/ChatPage-abc.js" />
        </ErrorBoundary>,
      );
      expect(screen.getByRole('alert').textContent).toContain('Pagewise wurde aktualisiert');
      await userEvent.setup().click(screen.getByRole('button', { name: 'Neu laden' }));
      expect(reload).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('zeigt bei anderen Fehlern eine allgemeine Meldung ohne den Fehlertext', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary resetKey="a">
        <Broken message="geheimer Inhalt der Nachricht" />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Hier ist etwas schiefgegangen');
    expect(alert.textContent).not.toContain('geheimer Inhalt');
  });

  it('setzt den Fehler zurück, wenn sich der Schlüssel ändert', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function Host() {
      const [key, setKey] = useState('a');
      return (
        <>
          <button type="button" onClick={() => setKey('b')}>
            weiter
          </button>
          <ErrorBoundary resetKey={key}>
            {key === 'a' ? <Broken message="kaputt" /> : <p>Wieder da</p>}
          </ErrorBoundary>
        </>
      );
    }
    render(<Host />);
    expect(screen.getByRole('alert')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'weiter' }));
    expect(screen.getByText('Wieder da')).toBeTruthy();
  });
});
