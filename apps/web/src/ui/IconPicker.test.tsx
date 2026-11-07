// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { de } from '../i18n/de';
import { IconPicker } from './IconPicker';
import { SUBJECT_ICONS } from './SubjectIcon';

/*
 * B-15 (D-095): Die Symbolnamen kommen aus i18n/de.ts und sind für Bildschirmleser weiter der Name
 * jedes Symbols (sr-only im Etikett des Radioknopfs).
 */

afterEach(cleanup);

function Beispiel() {
  const [wert, setWert] = useState('book');
  return <IconPicker legend="Symbol" value={wert} onChange={setWert} />;
}

describe('IconPicker: Namen im Zugänglichkeitsbaum', () => {
  it('zeigt 15 Radioknöpfe, jeder mit seinem Namen aus de.ts', () => {
    render(<Beispiel />);
    const knoepfe = screen.getAllByRole('radio');
    expect(knoepfe).toHaveLength(15);
    for (const { id } of SUBJECT_ICONS) {
      const name = de.subjectDialog.iconNames[id as keyof typeof de.subjectDialog.iconNames];
      const knopf = screen.getByRole('radio', { name }) as HTMLInputElement;
      expect(knopf.value, name).toBe(id);
    }
  });

  it('wählt ein Symbol per Namen', async () => {
    render(<Beispiel />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Kolben'));
    expect((screen.getByRole('radio', { name: 'Kolben' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Buch' }) as HTMLInputElement).checked).toBe(false);
  });
});
