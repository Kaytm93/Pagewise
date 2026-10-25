// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Drawer } from './Drawer';

/*
 * Die Schublade fährt beim Schließen aus und ruft `onClose` erst, wenn die Ausfahrt zu Ende ist. Ohne
 * Animation (Stufe „Aus“, oder kein Layout wie hier) schließt sie sofort, damit nichts hängen bleibt.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

function mount(onClose: () => void) {
  return render(
    <Drawer label="Navigation" onClose={onClose}>
      {(close) => (
        <button type="button" onClick={close}>
          Fach wählen
        </button>
      )}
    </Drawer>,
  );
}

describe('Drawer: Ausfahrt', () => {
  it('schließt sofort, wenn es keine Animation gibt (Stufe „Aus“)', async () => {
    const onClose = vi.fn();
    mount(onClose);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Fach wählen' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('wartet mit onClose bis zum Ende der Ausfahrt und fährt mit eigener Animation aus', async () => {
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = real(element, pseudo);
      return element.getAttribute('role') === 'dialog'
        ? new Proxy(style, {
            get: (target, key) =>
              key === 'animationName' ? 'lg-drawer-out' : Reflect.get(target, key),
          })
        : style;
    });
    const onClose = vi.fn();
    mount(onClose);
    const dialog = await screen.findByRole('dialog', { name: 'Navigation' });
    expect(dialog.className).toContain('lg-drawer-in');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Fach wählen' }));
    expect(dialog.className).toContain('lg-drawer-out');
    expect(dialog.className).not.toContain('lg-drawer-in');
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      fireEvent.animationEnd(dialog);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape startet die Ausfahrt ebenfalls', async () => {
    const onClose = vi.fn();
    mount(onClose);
    await screen.findByRole('dialog', { name: 'Navigation' });
    await userEvent.setup().keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
