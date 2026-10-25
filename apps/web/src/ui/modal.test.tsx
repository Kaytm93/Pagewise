// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Modal, ModalFooter } from './modal';

/*
 * S-01: Dialoge bilden einen Stapel. Escape schließt nur die oberste Ebene (ungespeicherte Eingaben im
 * unteren Dialog bleiben), die Scrollsperre fällt erst mit der letzten Ebene, der Hintergrund bleibt bis dahin
 * gesperrt, und der Fokus kehrt zum Auslöser zurück. Alle Namen und Texte sind erfunden.
 */

function Stapel({ long = 'Kurz' }: { long?: string }) {
  const [unten, setUnten] = useState(false);
  const [oben, setOben] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setUnten(true)}>
        Unten öffnen
      </button>
      {unten && (
        <Modal title={long} onClose={() => setUnten(false)}>
          <input aria-label="Entwurf" defaultValue="" />
          <button type="button" onClick={() => setOben(true)}>
            Oben öffnen
          </button>
          <ModalFooter>
            <button type="button">Speichern</button>
          </ModalFooter>
        </Modal>
      )}
      {oben && (
        <Modal title="Bestätigung" onClose={() => setOben(false)}>
          <button type="button">Ja</button>
        </Modal>
      )}
    </>
  );
}

afterEach(() => {
  document.body.style.overflow = '';
});

describe('Dialog-Stapel (ui/modal.tsx)', () => {
  it('Escape schließt nur die oberste Ebene, das zweite Escape die untere', async () => {
    const user = userEvent.setup();
    render(<Stapel />);
    await user.click(screen.getByRole('button', { name: 'Unten öffnen' }));
    await user.type(screen.getByLabelText('Entwurf'), 'noch nicht gespeichert');
    await user.click(screen.getByRole('button', { name: 'Oben öffnen' }));

    expect(screen.getAllByRole('dialog')).toHaveLength(2);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Bestätigung' })).toBeNull();
    // Der untere Dialog und seine Eingabe sind unversehrt.
    expect(screen.getByRole('dialog', { name: 'Kurz' })).toBeTruthy();
    expect((screen.getByLabelText('Entwurf') as HTMLInputElement).value).toBe(
      'noch nicht gespeichert',
    );

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('löst die Scrollsperre erst, wenn die letzte Ebene zu ist', async () => {
    const user = userEvent.setup();
    render(<Stapel />);
    expect(document.body.style.overflow).toBe('');
    await user.click(screen.getByRole('button', { name: 'Unten öffnen' }));
    await user.click(screen.getByRole('button', { name: 'Oben öffnen' }));
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('sperrt den Hintergrund und gibt die untere Ebene frei, sobald die obere schließt', async () => {
    const user = userEvent.setup();
    const { container } = render(<Stapel />);
    await user.click(screen.getByRole('button', { name: 'Unten öffnen' }));
    await user.click(screen.getByRole('button', { name: 'Oben öffnen' }));

    const unten = screen.getByRole('dialog', { name: 'Kurz', hidden: true }).closest('body > div');
    expect(container.hasAttribute('inert')).toBe(true);
    expect(unten?.hasAttribute('inert')).toBe(true);

    await user.keyboard('{Escape}');
    expect(unten?.hasAttribute('inert')).toBe(false);
    expect(container.hasAttribute('inert')).toBe(true);

    await user.keyboard('{Escape}');
    expect(container.hasAttribute('inert')).toBe(false);
  });

  it('gibt den Fokus an den Auslöser jeder Ebene zurück', async () => {
    const user = userEvent.setup();
    render(<Stapel />);
    const unten = screen.getByRole('button', { name: 'Unten öffnen' });
    await user.click(unten);
    const oben = screen.getByRole('button', { name: 'Oben öffnen' });
    await user.click(oben);

    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Oben öffnen' }));

    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Unten öffnen' }));
  });

  it('fällt auf den Hauptbereich zurück, wenn der Auslöser nicht mehr im DOM steht', async () => {
    const user = userEvent.setup();
    function Weg() {
      const [offen, setOffen] = useState(false);
      const [da, setDa] = useState(true);
      return (
        <>
          <main id="main" tabIndex={-1}>
            Inhalt
          </main>
          {da && (
            <button type="button" onClick={() => setOffen(true)}>
              Auslöser
            </button>
          )}
          {offen && (
            <Modal
              title="Weg"
              onClose={() => {
                setDa(false);
                setOffen(false);
              }}
            >
              <p>Text</p>
            </Modal>
          )}
        </>
      );
    }
    render(<Weg />);
    await user.click(screen.getByRole('button', { name: 'Auslöser' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Auslöser' })).toBeNull();
    expect(document.activeElement).toBe(document.getElementById('main'));
  });

  it('hält Tab und Shift+Tab in der obersten Ebene', async () => {
    const user = userEvent.setup();
    render(<Stapel />);
    await user.click(screen.getByRole('button', { name: 'Unten öffnen' }));
    const schliessen = screen.getByRole('button', { name: 'Schließen' });
    const speichern = screen.getByRole('button', { name: 'Speichern' });

    speichern.focus();
    await user.tab();
    expect(document.activeElement).toBe(schliessen);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(speichern);
  });

  it('bricht lange Überschriften um und hält die Fußzeile im Dialog fest', async () => {
    const user = userEvent.setup();
    render(<Stapel long={`Fach${'langerName'.repeat(12)}`} />);
    await user.click(screen.getByRole('button', { name: 'Unten öffnen' }));
    expect(screen.getByRole('heading', { level: 2 }).className).toMatch(/\bbreak-words\b/);
    const fuss = screen.getByRole('button', { name: 'Speichern' }).parentElement;
    expect(fuss?.className).toMatch(/\bsticky\b/);
    expect(fuss?.className).toMatch(/\bbottom-0\b/);
  });
});
