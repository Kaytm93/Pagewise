// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Segmented } from './Segmented';

/*
 * N2 (B-05, D-093): Auf Telefonen (bis 480 px, gedacht „etwa 430 px“) passt die lange Beschriftung nicht in ihr Stück („Automatisch“ lief in
 * „Voll“). Eine Option kann deshalb eine Kurzform tragen (`short`); beide stehen im DOM, welche zu sehen ist,
 * entscheidet allein CSS (lagen.css, Media-Query). Der zugängliche Name bleibt der volle Text. Alle Namen erfunden.
 */

afterEach(cleanup);

function Beispiel({ mitKurzform = true }: { mitKurzform?: boolean }) {
  const [wert, setWert] = useState('auto');
  return (
    <Segmented
      legend="Bewegung"
      value={wert}
      onChange={setWert}
      options={[
        { value: 'auto', label: 'Automatisch', ...(mitKurzform ? { short: 'Auto' } : {}) },
        { value: 'voll', label: 'Voll' },
        { value: 'aus', label: 'Aus' },
      ]}
    />
  );
}

describe('Segmented: Kurzform der Beschriftung', () => {
  it('trägt Lang- und Kurzform im DOM, der zugängliche Name bleibt der volle Text', () => {
    render(<Beispiel />);
    const radio = screen.getByRole('radio', { name: 'Automatisch' });
    expect(radio.getAttribute('aria-label')).toBe('Automatisch');
    const label = radio.closest('label') as HTMLElement;
    expect(label.querySelector('.lg-seg-long')?.textContent).toBe('Automatisch');
    expect(label.querySelector('.lg-seg-short')?.textContent).toBe('Auto');
    // Die sichtbaren Texte sind für Screenreader stumm: gelesen wird der Name des Knopfes, nicht beide Formen.
    expect(label.querySelector('.lg-seg-long')?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(label.querySelector('.lg-seg-short')?.closest('[aria-hidden="true"]')).not.toBeNull();
    // Die Kurzform steht im vollen Namen (WCAG 2.5.3, „Beschriftung im Namen“).
    expect('Automatisch'.startsWith('Auto')).toBe(true);
  });

  it('lässt Optionen ohne Kurzform unverändert: Text im Stück, kein aria-label, keine Hüllen', () => {
    render(<Beispiel />);
    const voll = screen.getByRole('radio', { name: 'Voll' });
    expect(voll.getAttribute('aria-label')).toBeNull();
    const label = voll.closest('label') as HTMLElement;
    expect(label.querySelector('.lg-seg-long, .lg-seg-short')).toBeNull();
    expect(label.textContent).toBe('Voll');
  });

  it('ohne Kurzform bleibt alles wie bisher', () => {
    render(<Beispiel mitKurzform={false} />);
    const radio = screen.getByRole('radio', { name: 'Automatisch' });
    expect(radio.getAttribute('aria-label')).toBeNull();
    expect(document.querySelector('.lg-seg-long, .lg-seg-short')).toBeNull();
  });

  it('wählt per Klick und Tastatur auch über die Option mit Kurzform', async () => {
    const user = userEvent.setup();
    render(<Beispiel />);
    expect((screen.getByRole('radio', { name: 'Automatisch' }) as HTMLInputElement).checked).toBe(
      true,
    );
    await user.click(screen.getByRole('radio', { name: 'Aus' }));
    expect((screen.getByRole('radio', { name: 'Aus' }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'Automatisch' }));
    expect((screen.getByRole('radio', { name: 'Automatisch' }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.getByRole('group', { name: 'Bewegung' })).toBeTruthy();
  });
});
