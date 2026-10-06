// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ActivityEntry } from '../../api/types';
import { AgentActivity } from './AgentActivity';

const steps: ActivityEntry[] = [
  { id: 't1', tool: 'Write', target: 'uebersicht.pdf', state: 'done' },
];

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
    const arrow = summary.querySelector('svg');
    if (!arrow) throw new Error('Kein Pfeil-Symbol im summary');
    expect(arrow.getAttribute('aria-hidden')).toBe('true');
    expect(arrow.getAttribute('class')).toContain('mo-arrow');
    // Die Zusammenfassung bleibt eine 44-px-Fläche (min-h-11) und zeigt den Zustand per CSS-Klasse.
    expect(summary.className).toContain('min-h-11');
    expect(container.querySelector('style')).toBeNull();
  });

  it('während der Arbeit (live) gibt es keine Zusammenfassung und keinen Pfeil', () => {
    render(<AgentActivity steps={steps} live />);
    expect(screen.queryByText('Was der Agent getan hat (1)')).toBeNull();
    expect(screen.queryByText('Details anzeigen')).toBeNull();
  });
});
