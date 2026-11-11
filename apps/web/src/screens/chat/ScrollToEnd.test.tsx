// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScrollToEnd } from './ScrollToEnd';

/**
 * „Zum Ende“-Knopf (F-082, D-118): jsdom kennt weder Layout noch CSS aus `screens.css`. Hier steht, was der
 * Baustein selbst festlegt: Name, Sichtbarkeit im Dokument und für die Tastatur, Auslöser, Punkt beim Schreiben.
 * Lage, Größe, Übergänge und Gestaltung stehen in `ScrollToEnd.structure.test.ts` und werden im Browser gemessen.
 */

const NAME = 'Zum Ende des Chats';

function setup(props: Partial<Parameters<typeof ScrollToEnd>[0]> = {}) {
  const onToEnd = vi.fn();
  const view = render(
    <div>
      <button type="button">Davor</button>
      <ScrollToEnd visible writing={false} onToEnd={onToEnd} {...props} />
      <textarea aria-label="Nachricht" />
    </div>,
  );
  return { onToEnd, ...view };
}

describe('ScrollToEnd', () => {
  it('ist ein Knopf mit dem Namen „Zum Ende des Chats“, wenn er sichtbar ist', () => {
    setup();
    const button = screen.getByRole('button', { name: NAME });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('title')).toBe(NAME);
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('ist nicht erreichbar, wenn er verborgen ist: nicht im Baum der Bedienhilfen und inert', () => {
    const { container } = setup({ visible: false });
    expect(screen.queryByRole('button', { name: NAME })).toBeNull();
    const shell = container.querySelector('.lg-toend');
    expect(shell?.getAttribute('data-visible')).toBe('false');
    expect(shell?.getAttribute('aria-hidden')).toBe('true');
    expect(shell?.hasAttribute('inert')).toBe(true);
  });

  it('ist im sichtbaren Zustand nicht inert und nicht versteckt', () => {
    const { container } = setup();
    const shell = container.querySelector('.lg-toend');
    expect(shell?.getAttribute('data-visible')).toBe('true');
    expect(shell?.hasAttribute('inert')).toBe(false);
    expect(shell?.hasAttribute('aria-hidden')).toBe(false);
  });

  it('wird mit Tab nach dem vorigen Element und vor dem Eingabefeld erreicht', async () => {
    const user = userEvent.setup();
    setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Davor' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: NAME }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Nachricht' }));
  });

  it('löst mit der Maus aus (byKeyboard falsch)', async () => {
    const user = userEvent.setup();
    const { onToEnd } = setup();
    await user.click(screen.getByRole('button', { name: NAME }));
    expect(onToEnd).toHaveBeenCalledTimes(1);
    expect(onToEnd).toHaveBeenCalledWith(false);
  });

  it('löst mit Enter und mit der Leertaste aus (byKeyboard wahr)', async () => {
    const user = userEvent.setup();
    const { onToEnd } = setup();
    screen.getByRole('button', { name: NAME }).focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onToEnd).toHaveBeenCalledTimes(2);
    expect(onToEnd).toHaveBeenNthCalledWith(1, true);
    expect(onToEnd).toHaveBeenNthCalledWith(2, true);
  });

  it('zeigt beim Schreiben einen Punkt (data-writing), sonst nicht', () => {
    const { rerender, onToEnd } = setup({ writing: true });
    expect(screen.getByRole('button', { name: NAME })?.getAttribute('data-writing')).toBe('true');
    rerender(
      <div>
        <ScrollToEnd visible writing={false} onToEnd={onToEnd} />
      </div>,
    );
    expect(screen.getByRole('button', { name: NAME })?.hasAttribute('data-writing')).toBe(false);
  });

  it('reicht die Fachfarbe als data-subj weiter, für den Punkt (ohne Fach fehlt das Attribut)', () => {
    const { container, rerender, onToEnd } = setup({ subjectColor: 3 });
    expect(container.querySelector('.lg-toend')?.getAttribute('data-subj')).toBe('3');
    rerender(
      <div>
        <ScrollToEnd visible writing={false} subjectColor={null} onToEnd={onToEnd} />
      </div>,
    );
    expect(container.querySelector('.lg-toend')?.hasAttribute('data-subj')).toBe(false);
  });

  it('trägt keinen Inline-Stil (CSP)', () => {
    const { container } = setup();
    expect(container.querySelector('.lg-toend')?.hasAttribute('style')).toBe(false);
    expect(container.querySelector('.lg-toend-button')?.hasAttribute('style')).toBe(false);
  });
});
