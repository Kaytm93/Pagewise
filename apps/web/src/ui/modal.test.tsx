// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Modal, ModalFooter } from './modal';

/*
 * S-01: Dialoge bilden einen Stapel. Escape schließt nur die oberste Ebene (ungespeicherte Eingaben im
 * unteren Dialog bleiben), die Scrollsperre fällt erst mit der letzten Ebene, der Hintergrund bleibt bis dahin
 * gesperrt, und der Fokus kehrt zum Auslöser zurück. Alle Namen und Texte sind erfunden.
 *
 * D-091: Safari und iOS fokussieren einen angeklickten Knopf nicht. Die Fälle „WebKit“ unten ahmen das nach: nur
 * Zeigerereignisse über `fireEvent`, ohne dass der Knopf den Fokus bekommt (`user.click` täte das wie Chromium).
 */

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

/** Der Knopf verschwindet im selben Schritt, in dem der Dialog aufgeht (Ansicht zeichnet neu). */
function Einmal() {
  const [da, setDa] = useState(true);
  const [offen, setOffen] = useState(false);
  return (
    <>
      <main id="main" tabIndex={-1}>
        Inhalt
      </main>
      {da && (
        <button
          type="button"
          onClick={() => {
            setDa(false);
            setOffen(true);
          }}
        >
          Einmal
        </button>
      )}
      {offen && (
        <Modal title="Weg" onClose={() => setOffen(false)}>
          <p>Text</p>
        </Modal>
      )}
    </>
  );
}

/** Seite mit Hauptbereich wie die App (`main#main`, `tabindex=-1`) und einem Dialog, optional mit zweiter Ebene. */
function Seite({ obenWeg = false }: { obenWeg?: boolean }) {
  const [unten, setUnten] = useState(false);
  const [oben, setOben] = useState(false);
  const [erledigt, setErledigt] = useState(false);
  return (
    <>
      <main id="main" tabIndex={-1}>
        <button type="button">Anderer Knopf</button>
        <button type="button" onClick={() => setUnten(true)}>
          Unten öffnen
        </button>
      </main>
      {unten && (
        <Modal title="Kurz" onClose={() => setUnten(false)}>
          {!(obenWeg && erledigt) && (
            <button type="button" onClick={() => setOben(true)}>
              Oben öffnen
            </button>
          )}
        </Modal>
      )}
      {oben && (
        <Modal
          title="Bestätigung"
          onClose={() => {
            setErledigt(true);
            setOben(false);
          }}
        >
          <button type="button">Ja</button>
        </Modal>
      )}
    </>
  );
}

/** Safari: Zeigerereignisse treffen den Knopf, der Fokus wandert aber zum Vorfahren (oder bleibt auf body). */
function zeigerKlick(knopf: HTMLElement, fokusAuf: HTMLElement | null) {
  fireEvent.pointerDown(knopf);
  fireEvent.mouseDown(knopf);
  if (fokusAuf) fokusAuf.focus();
  else (document.activeElement as HTMLElement | null)?.blur();
  fireEvent.pointerUp(knopf);
  fireEvent.mouseUp(knopf);
  fireEvent.click(knopf);
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
  describe('Fokusrückgabe in WebKit (D-091)', () => {
    it.each([
      ['body', () => null],
      ['main', () => document.getElementById('main')],
    ])(
      'nach Mausklick ohne Fokus auf dem Knopf (Fokus auf %s) kehrt der Fokus zum Knopf zurück',
      async (_name, ziel) => {
        const user = userEvent.setup();
        render(<Seite />);
        const knopf = screen.getByRole('button', { name: 'Unten öffnen' });
        zeigerKlick(knopf, ziel());
        expect(screen.getByRole('dialog', { name: 'Kurz' })).toBeTruthy();
        expect(document.activeElement).not.toBe(knopf);

        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(knopf);
      },
    );

    it('nimmt das angeklickte Steuerelement auch, wenn ein Kindelement des Knopfes getroffen wurde', async () => {
      const user = userEvent.setup();
      render(<Seite />);
      const knopf = screen.getByRole('button', { name: 'Unten öffnen' });
      const inhalt = document.createElement('span');
      knopf.appendChild(inhalt);
      fireEvent.pointerDown(inhalt);
      document.getElementById('main')?.focus();
      fireEvent.click(inhalt);

      await user.keyboard('{Escape}');
      expect(document.activeElement).toBe(knopf);
    });

    it('zwei Ebenen: jede kehrt zu ihrem Knopf zurück, zuletzt zum Ursprung', async () => {
      const user = userEvent.setup();
      render(<Seite />);
      const unten = screen.getByRole('button', { name: 'Unten öffnen' });
      zeigerKlick(unten, document.getElementById('main'));

      // Safari fokussiert in der unteren Ebene das Dialogpanel statt des Knopfes.
      const panel = screen.getByRole('dialog', { name: 'Kurz' });
      const oben = screen.getByRole('button', { name: 'Oben öffnen' });
      zeigerKlick(oben, panel);
      expect(screen.getAllByRole('dialog')).toHaveLength(2);

      await user.keyboard('{Escape}');
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Oben öffnen' }));

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(unten);
    });

    it('Tastatur wie bisher: das fokussierte Steuerelement gilt, nicht das früher angeklickte', async () => {
      const user = userEvent.setup();
      render(<Seite />);
      // Früher angeklickt, aber nicht der Auslöser.
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Anderer Knopf' }));
      const knopf = screen.getByRole('button', { name: 'Unten öffnen' });
      knopf.focus();
      await user.keyboard('{Enter}');
      expect(screen.getByRole('dialog', { name: 'Kurz' })).toBeTruthy();

      await user.keyboard('{Escape}');
      expect(document.activeElement).toBe(knopf);
    });

    it('Auslöser nicht mehr im DOM: Hauptbereich', async () => {
      const user = userEvent.setup();
      render(<Weg />);
      const knopf = screen.getByRole('button', { name: 'Auslöser' });
      zeigerKlick(knopf, document.getElementById('main'));
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('button', { name: 'Auslöser' })).toBeNull();
      expect(document.activeElement).toBe(document.getElementById('main'));
    });

    it('Auslöser der oberen Ebene weg: Fokus auf das Panel der unteren Ebene, dann zum Ursprung', async () => {
      const user = userEvent.setup();
      render(<Seite obenWeg />);
      const unten = screen.getByRole('button', { name: 'Unten öffnen' });
      zeigerKlick(unten, document.getElementById('main'));
      const panel = screen.getByRole('dialog', { name: 'Kurz' });
      zeigerKlick(screen.getByRole('button', { name: 'Oben öffnen' }), panel);

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('button', { name: 'Oben öffnen' })).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Kurz' }));

      await user.keyboard('{Escape}');
      expect(document.activeElement).toBe(unten);
    });

    it('ein Knopf, der beim Öffnen schon aus dem DOM ist, wird nicht als Ziel gemerkt', async () => {
      const user = userEvent.setup();
      render(<Einmal />);
      const knopf = screen.getByRole('button', { name: 'Einmal' });
      zeigerKlick(knopf, null);
      expect(screen.getByRole('dialog', { name: 'Weg' })).toBeTruthy();
      expect(knopf.isConnected).toBe(false);

      await user.keyboard('{Escape}');
      expect(document.activeElement).toBe(document.getElementById('main'));
    });
  });
});
