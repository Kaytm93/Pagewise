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
        steps={[...steps, { id: 't2', tool: 'Bash', target: null, state: 'error' }]}
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
