// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Reasoning } from './Reasoning';

afterEach(cleanup);

describe('Reasoning', () => {
  it('ist eingeklappt, wenn die Antwort fertig ist', () => {
    render(<Reasoning text="Erst die Frage prüfen." live={false} />);
    expect(screen.getByText('Denkprozess').closest('details')?.open).toBe(false);
    expect(screen.getByText('Erst die Frage prüfen.')).toBeTruthy();
  });

  it('ist offen, solange die Antwort entsteht', () => {
    render(<Reasoning text="Gerade überlegt." live />);
    expect(screen.getByText('Denkprozess').closest('details')?.open).toBe(true);
  });

  it('zeigt den Denktext als Text, nie als HTML', () => {
    render(<Reasoning text="<b>fett</b>" live={false} />);
    expect(screen.getByText('<b>fett</b>')).toBeTruthy();
    expect(document.querySelector('b')).toBeNull();
  });
});
