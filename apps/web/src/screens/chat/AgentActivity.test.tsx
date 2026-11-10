// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityEntry } from '../../api/types';
import { AgentActivity } from './AgentActivity';

const steps: ActivityEntry[] = [
  { id: 't1', tool: 'Write', target: 'uebersicht.pdf', file: 'uebersicht.pdf', state: 'done' },
];

/**matchMedia-Ersatz wie fx.test.ts: eine Frage, umschaltbar, Zuhörer werden benachrichtigt. */
function mockMedia(fits: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: fits,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', (text: string) =>
    text.includes('min-width: 900px')
      ? query
      : { matches: false, addEventListener() {}, removeEventListener() {} },
  );
  return {
    narrow() {
      query.matches = false;
      for (const listener of listeners) listener();
    },
  };
}

/** Aufgeklappte Live-Spalte (kein details) oder eingeklappte Fläche? (jsdom zeigt Details-Kinder weiter an.) */
function offeneSpalte(container: HTMLElement): Element | null {
  return container.querySelector('details') === null ? container.querySelector('ol') : null;
}

afterEach(() => vi.unstubAllGlobals());

describe('AgentActivity: Aufklapp-Zustand erkennbar (chat-render#06)', () => {
  it('der Zusammenfassung ist der Zusatz „Details anzeigen“ zugeordnet, solange sie zugeklappt ist', () => {
    render(<AgentActivity steps={steps} live={false} />);
    const summary = screen.getByText('Was der Agent getan hat (1)').closest('summary');
    if (!summary) throw new Error('Kein summary gerendert');
    expect((summary.closest('details') as HTMLDetailsElement).open).toBe(false);
    // sr-only-Zusatz aus i18n, an derselben aufklappbaren Fläche
    expect(screen.getByText('Details anzeigen')).toBeTruthy();
    expect(screen.queryByText('Details verbergen')).toBeNull();
  });

  it('beim Aufklappen kippt der Zusatz auf „Details verbergen“, details.open wird wahr', async () => {
    const user = userEvent.setup();
    render(<AgentActivity steps={steps} live={false} />);
    const summary = screen.getByText('Was der Agent getan hat (1)').closest('summary');
    if (!summary) throw new Error('Kein summary gerendert');
    await user.click(summary);
    expect((summary.closest('details') as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByText('Details verbergen')).toBeTruthy();
    expect(screen.queryByText('Details anzeigen')).toBeNull();
  });

  it('der sichtbare Pfeil hängt am summary, ist für Werkzeuge verborgen und trägt die Dreh-Klasse', () => {
    const { container } = render(<AgentActivity steps={steps} live={false} />);
    const summary = screen.getByText('Was der Agent getan hat (1)').closest('summary');
    if (!summary) throw new Error('Kein summary gerendert');
    const arrow = summary.querySelector('.mo-arrow');
    if (!arrow) throw new Error('Kein Pfeil-Symbol im summary');
    expect(arrow.getAttribute('aria-hidden')).toBe('true');
    expect(arrow.getAttribute('class')).toContain('mo-arrow');
    // Die Zusammenfassung bleibt eine 44-px-Fläche (min-h-11) und zeigt den Zustand per CSS-Klasse.
    expect(summary.className).toContain('min-h-11');
    expect(container.querySelector('style')).toBeNull();
  });

  it('der Kopf steht in einer Zeile und trägt ein Statuszeichen: gezeichneter Haken, bei Fehlern ein Kreuz', () => {
    const { container, rerender } = render(<AgentActivity steps={steps} live={false} />);
    const summary = container.querySelector('summary') as HTMLElement;
    expect(summary.className).toContain('whitespace-nowrap');
    expect(summary.className).toContain('lg-agent-head');
    expect(summary.getAttribute('data-state')).toBe('done');
    const check = summary.querySelector('.lg-tool-check');
    expect(check?.getAttribute('aria-hidden')).toBe('true');
    expect(check?.querySelector('path')?.getAttribute('pathLength')).toBe('1');

    rerender(
      <AgentActivity
        steps={[...steps, { id: 't2', tool: 'Bash', target: null, file: null, state: 'error' }]}
        live={false}
      />,
    );
    const failed = container.querySelector('summary') as HTMLElement;
    expect(failed.getAttribute('data-state')).toBe('error');
    expect(failed.querySelector('.lg-tool-cross')).not.toBeNull();
    expect(failed.querySelector('.lg-tool-check')).toBeNull();
  });

  it('erledigte Schritte tragen den gezeichneten Haken in jeder Richtung', () => {
    const { container } = render(<AgentActivity steps={steps} live />);
    expect(container.querySelectorAll('.lg-tool-check')).toHaveLength(1);
    expect(container.querySelector('style')).toBeNull();
  });

  it('während der Arbeit (live) gibt es keine Zusammenfassung und keinen Pfeil', () => {
    render(<AgentActivity steps={steps} live />);
    expect(screen.queryByText('Was der Agent getan hat (1)')).toBeNull();
    expect(screen.queryByText('Details anzeigen')).toBeNull();
  });
});

/*
 * H-C04 (D-106): Der Aktivitätsstream lebt vom bestehenden Ereignisstrom — neue Zeilen erscheinen per
 * rerender mit gewachsenem steps-Array (im Chat: dispatch je `activity`-Ereignis), ohne Remount und ohne
 * Polling. Gezeigt wird je Zeile Symbol + „Werkzeug → Ziel“ (B-04: file vor target), nie Inhalte.
 */
describe('AgentActivity: Live-Spalte (H-C04)', () => {
  const laufend: ActivityEntry = {
    id: 'a1',
    tool: 'Bash',
    target: 'Ordner zeigen',
    file: null,
    state: 'running',
  };
  const fertig: ActivityEntry = { ...laufend, state: 'done' };
  const geschrieben: ActivityEntry = {
    id: 'a2',
    tool: 'Write',
    target: 'ordner/bericht.pdf',
    file: 'bericht.pdf',
    state: 'done',
  };

  it('Zeilen erscheinen nacheinander ohne Remount: dasselbe <ol> trägt wachsende Einträge', () => {
    const { container, rerender } = render(<AgentActivity steps={[laufend]} live />);
    const liste = container.querySelector('ol');
    expect(liste).toBeTruthy();
    expect(liste?.textContent).toContain('Befehl: Ordner zeigen');

    rerender(<AgentActivity steps={[laufend, fertig]} live />);
    rerender(<AgentActivity steps={[laufend, fertig, geschrieben]} live />);
    // Dasselbe Element, kein Remount; die Zeile mit file zeigt nur den reinen Namen, nie den Pfad.
    expect(container.querySelector('ol')).toBe(liste);
    const zeilen = liste ? [...liste.querySelectorAll('li')] : [];
    expect(zeilen).toHaveLength(3);
    expect(zeilen[0]?.textContent).toContain('Befehl: Ordner zeigen');
    expect(zeilen[2]?.textContent).toContain('Geschrieben: bericht.pdf');
    expect(zeilen[2]?.textContent).not.toContain('ordner');
    // Der laufende Schritt trägt den pulsierenden Punkt.
    expect(zeilen[0]?.querySelector('.animate-pulse')).not.toBeNull();
    expect(zeilen[2]?.querySelector('.lg-tool-check')).not.toBeNull();
    expect(container.querySelector('style')).toBeNull();
  });

  it('übersetzte Werkzeugnamen mit Datei (file) und ohne (target), Zustand unsichtbar für Sehende', () => {
    const { container } = render(
      <AgentActivity
        steps={[
          { id: 'b1', tool: 'Read', target: 'x', file: 'notiz.md', state: 'done' },
          { id: 'b2', tool: 'Grep', target: 'Suchwort', file: null, state: 'running' },
          { id: 'b3', tool: 'TodoWrite', target: null, file: null, state: 'error' },
        ]}
        live
      />,
    );
    const texte = [...container.querySelectorAll('li span')].map((span) => span.textContent);
    expect(texte).toContain('Gelesen: notiz.md');
    expect(texte).toContain('Durchsucht: Suchwort');
    expect(texte).toContain('Liste geführt');
    expect(container.querySelector('.lg-tool-cross')).not.toBeNull();
    // Fehlermeldung als sr-only-Zusatz.
    expect(screen.getByText('fehlgeschlagen')).toBeTruthy();
  });

  it('unbekanntes Werkzeug fällt auf den Rohnamen zurück (Fallback)', () => {
    const { container } = render(
      <AgentActivity
        steps={[{ id: 'c1', tool: 'Keksdose', target: 'Kekse', file: null, state: 'done' }]}
        live
      />,
    );
    expect(container.querySelector('li')?.textContent).toContain('Keksdose: Kekse');
  });

  it('zeigt ohne matchMedia (jsdom) die offene Spalte wie bisher', () => {
    const { container } = render(<AgentActivity steps={[laufend, fertig]} live />);
    expect(offeneSpalte(container)).not.toBeNull();
    expect(screen.queryByText('Was der Agent getan hat (2)')).toBeNull();
  });

  it('zeigt auf schmalen Fenstern die eingeklappte Fläche mit laufendem Punkt, keine offene Spalte', () => {
    mockMedia(false);
    const { container } = render(<AgentActivity steps={[laufend, fertig]} live />);
    // Eingeklappt: Zusammenfassung mit Anzahl, keine offene Spalte (Details-Kinder bleiben im jsdom-DOM).
    expect(screen.getByText('Was der Agent getan hat (2)')).toBeTruthy();
    expect(offeneSpalte(container)).toBeNull();
    // Während der Arbeit trägt der Kopf den laufenden Punkt statt des fertigen Hakens.
    const summary = screen.getByText('Was der Agent getan hat (2)').closest('summary');
    expect(summary?.getAttribute('data-state')).toBe('running');
    expect(summary?.querySelector('.animate-pulse')).not.toBeNull();
    // Bedienfläche bleibt 44 px hoch.
    expect(summary?.className).toContain('min-h-11');
  });

  it('wird das Fenster beim Lauf schmaler, klappt die Spalte von selbst zu (matchMedia-Muster)', () => {
    const media = mockMedia(true);
    const { container } = render(<AgentActivity steps={[laufend, fertig]} live />);
    expect(offeneSpalte(container)).not.toBeNull();
    act(() => media.narrow());
    expect(offeneSpalte(container)).toBeNull();
    expect(screen.getByText('Was der Agent getan hat (2)')).toBeTruthy();
  });
});
