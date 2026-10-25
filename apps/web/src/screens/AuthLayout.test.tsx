// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthLayout } from './AuthLayout';

describe('AuthLayout', () => {
  it('trägt die Karte als eigene Hülle ohne Randlinie des Ordners (lg-sheet-auth)', () => {
    const { container } = render(
      <AuthLayout title="Beispiel" lead="Erfundener Text">
        <p>Inhalt</p>
      </AuthLayout>,
    );
    const card = container.querySelector('.lg-sheet');
    expect(card).not.toBeNull();
    expect(card?.classList.contains('lg-sheet-auth')).toBe(true);
    expect(card?.querySelector('h1')?.textContent).toBe('Beispiel');
  });
});
