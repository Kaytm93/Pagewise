// @vitest-environment jsdom
import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../api/types';
import { Markdown } from './Markdown';
import { MessageItem } from './MessageItem';
import { useCopy } from './useCopy';

/*
 * Rückmeldung des Kopierens (chat-render#13, M4-T019): Erfolg und Fehler erscheinen in einer
 * kleinen aria-live-Region (eine je Kopieren-Kontext, nie am ganzen Container) — Erfolg als
 * unsichtbare Ansage „Kopiert“, Fehler sichtbar als „Kopieren nicht möglich“, statt stillen
 * Verschluckens. jsdom hat keine Zwischenablage: Der Test setzt sie je Fall als Stub.
 */

/** Setzt `navigator.clipboard` (fehlt in jsdom) und liefert den writeText-Stub zurück. */
function setzeClipboard(ergebnis: 'ok' | 'verweigert') {
  const writeText = vi.fn(() =>
    ergebnis === 'ok'
      ? Promise.resolve()
      : Promise.reject(new DOMException('Zwischenablage gesperrt', 'NotAllowedError')),
  );
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

function antwort(): ChatMessage {
  return {
    id: 'n2',
    seq: 2,
    role: 'assistant',
    content: 'Nur ein Satz zum Kopieren.',
    status: 'complete',
    providerId: null,
    model: null,
    engineProfileId: null,
    errorCode: null,
    activity: [],
    assets: [],
    reasoning: null,
    tokensPerSecond: null,
    costUsd: null,
    createdAt: 0,
  };
}

function zeigeAntwort() {
  return render(
    <MessageItem
      message={antwort()}
      live={false}
      thinking={false}
      canRetry={false}
      onRetry={() => {}}
    />,
  );
}

afterEach(() => {
  // Den Clipboard-Stub wieder entfernen (konfigurierbar angelegt), damit kein Fall in den nächsten sickert.
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('useCopy: Zustand des Kopierens (M4-T019)', () => {
  it('Erfolg: Text landet in der Zwischenablage, Zustand „copied“, nach 1,8 s wieder still', async () => {
    vi.useFakeTimers();
    try {
      const writeText = setzeClipboard('ok');
      const { result } = renderHook(() => useCopy());
      expect(result.current.copyState).toBe('idle');
      await act(async () => {
        await result.current.copy('Beispieltext');
      });
      expect(writeText).toHaveBeenCalledWith('Beispieltext');
      expect(result.current.copyState).toBe('copied');
      act(() => {
        vi.advanceTimersByTime(1800);
      });
      expect(result.current.copyState).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Fehler: abgelehnte Zwischenablage wird nicht verschluckt, Zustand „failed“ bleibt ohne Timer', async () => {
    vi.useFakeTimers();
    try {
      setzeClipboard('verweigert');
      const { result } = renderHook(() => useCopy());
      await act(async () => {
        await result.current.copy('Beispieltext');
      });
      expect(result.current.copyState).toBe('failed');
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      // Keine Rücksetzung: der Fehler bleibt stehen, bis erneut kopiert wird.
      expect(result.current.copyState).toBe('failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Fehlt die Zwischenablage ganz (z. B. ohne HTTPS), gilt das als Fehler', async () => {
    // navigator.clipboard bleibt undefiniert; der Zugriff wirft, statt ein Versprechen zu liefern.
    const { result } = renderHook(() => useCopy());
    await act(async () => {
      await result.current.copy('Beispieltext');
    });
    expect(result.current.copyState).toBe('failed');
  });
});

describe('Kopieren-Rückmeldung an der Antwort (M4-T019)', () => {
  it('Erfolg: „Kopiert“ steht in einer polite Live-Region, unsichtbar, ohne Fehltext', async () => {
    // Erst userEvent einrichten, dann die Zwischenablage setzen: setup() bringt einen eigenen
    // Clipboard-Stub mit, der sonst den Mock für den Fehlerfall überschriebe.
    const user = userEvent.setup();
    setzeClipboard('ok');
    zeigeAntwort();
    await user.click(screen.getByRole('button', { name: 'Antwort kopieren' }));
    const region = await screen.findByText('Kopiert');
    expect(region.className).toContain('sr-only');
    expect(region.closest('[aria-live="polite"]')).toBeTruthy();
    expect(screen.queryByText('Kopieren nicht möglich')).toBeNull();
  });

  it('Fehler: „Kopieren nicht möglich“ ist sichtbar, die Regionsansage bleibt leer', async () => {
    const user = userEvent.setup();
    setzeClipboard('verweigert');
    zeigeAntwort();
    await user.click(screen.getByRole('button', { name: 'Antwort kopieren' }));
    // Live-Regionen tragen ihren Namen nicht aus dem Inhalt (ARIA): Rolle und Text getrennt prüfen.
    const meldung = await screen.findByText('Kopieren nicht möglich');
    expect(meldung.getAttribute('role')).toBe('status');
    // Sichtbar: nicht von Screenreadern allein, sondern für alle lesbar (keine sr-only-Klasse).
    expect(meldung.className).not.toContain('sr-only');
    expect(meldung.closest('[aria-live="polite"]')).toBeTruthy();
    expect(screen.queryByText('Kopiert')).toBeNull();
  });

  it('Genau eine Live-Region je Nachricht, der Knopf bleibt im Fluss der Fußzeile', async () => {
    const user = userEvent.setup();
    setzeClipboard('verweigert');
    const { container } = zeigeAntwort();
    await user.click(screen.getByRole('button', { name: 'Antwort kopieren' }));
    await screen.findByText('Kopieren nicht möglich');
    const artikel = container.querySelector('article');
    expect(artikel).toBeTruthy();
    expect(artikel?.querySelectorAll('[aria-live]')).toHaveLength(1);
    // Keine aria-live-Verschachtelung im ganze Container: nur die kleine Region trägt sie.
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(
      within(artikel as HTMLElement).getByRole('button', { name: 'Antwort kopieren' }),
    ).toBeTruthy();
  });
});

describe('Kopieren-Rückmeldung am Codeblock (M4-T019)', () => {
  it('Fehler: „Kopieren nicht möglich“ erscheint sichtbar unter dem Code', async () => {
    const user = userEvent.setup();
    setzeClipboard('verweigert');
    render(<Markdown text={'```\nprint(1)\n```'} />);
    await user.click(screen.getByRole('button', { name: 'Code kopieren' }));
    const meldung = await screen.findByText('Kopieren nicht möglich');
    expect(meldung.getAttribute('role')).toBe('status');
    expect(meldung.className).not.toContain('sr-only');
    expect(meldung.closest('[aria-live="polite"]')).toBeTruthy();
    // Der Blockcode selbst bleibt als <code> erhalten.
    expect(screen.getByText('print(1)')).toBeTruthy();
  });

  it('Erfolg: „Kopiert“ wird über die Live-Region angesagt, kein sichtbarer Fehltext', async () => {
    const user = userEvent.setup();
    setzeClipboard('ok');
    render(<Markdown text={'```\nprint(1)\n```'} />);
    await user.click(screen.getByRole('button', { name: 'Code kopieren' }));
    expect(await screen.findByText('Kopiert')).toBeTruthy();
    expect(screen.queryByText('Kopieren nicht möglich')).toBeNull();
  });
});
