// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Tabs } from './Tabs';

/*
 * Die Reiter bleiben echte Tabs, auch wenn „Lagen“ sie als Mappenreiter zeichnet (lagen.css): Rollen,
 * Roving-Tabindex und Pfeiltasten gehören zu ui/Tabs.tsx und dürfen vom Aussehen nicht abhängen.
 */

type Value = 'eins' | 'zwei' | 'drei';

function Beispiel() {
  const [value, setValue] = useState<Value>('eins');
  return (
    <Tabs
      label="Beispielreiter"
      className="lg-register"
      value={value}
      onChange={setValue}
      tabs={[
        { value: 'eins', label: 'Eins' },
        { value: 'zwei', label: 'Zwei' },
        { value: 'drei', label: 'Drei' },
      ]}
      panel={<p>Inhalt von {value}</p>}
    />
  );
}

describe('Reiter (Tabs)', () => {
  it('trägt Rollen und einen einzigen Tab-Stopp beim gewählten Reiter', () => {
    render(<Beispiel />);
    const list = screen.getByRole('tablist', { name: 'Beispielreiter' });
    expect(list.classList.contains('lg-register')).toBe(true);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(screen.getByRole('tabpanel').textContent).toBe('Inhalt von eins');
  });

  it('wechselt mit den Pfeiltasten (rundum) und springt mit Pos1 und Ende', async () => {
    const user = userEvent.setup();
    render(<Beispiel />);
    const [eins, zwei, drei] = screen.getAllByRole('tab') as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];

    eins.focus();
    await user.keyboard('{ArrowRight}');
    expect(zwei.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(zwei);

    await user.keyboard('{End}');
    expect(drei.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(drei);

    await user.keyboard('{ArrowRight}');
    expect(eins.getAttribute('aria-selected')).toBe('true');

    await user.keyboard('{ArrowLeft}');
    expect(drei.getAttribute('aria-selected')).toBe('true');

    await user.keyboard('{Home}');
    expect(eins.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('Inhalt von eins');
  });
});
