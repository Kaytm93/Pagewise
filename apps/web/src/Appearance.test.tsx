// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer } from './test/fake-server';

function openSettings() {
  window.history.replaceState(null, '', '/settings');
  return render(<App client={new ApiClient({ fetch: new FakeServer('unlocked').fetch })} />);
}

const levels = () =>
  [...document.documentElement.classList].filter((name) => name.startsWith('fx-'));

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-design');
});
afterEach(() => {
  window.localStorage.clear();
  document.documentElement.className = '';
  window.history.replaceState(null, '', '/');
});

describe('Einstellungen: Darstellung', () => {
  it('stellt die Bewegung um, merkt sich die Wahl und erklärt sie', async () => {
    openSettings();
    const user = userEvent.setup();
    const group = within(await screen.findByRole('group', { name: 'Bewegung' }));
    // Voreinstellung: folgt dem Gerät
    expect((group.getByRole('radio', { name: 'Automatisch' }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.getByText(/Folgt dem Gerät: wünscht es weniger Bewegung/)).toBeTruthy();

    await user.click(group.getByRole('radio', { name: 'Aus' }));
    expect(levels()).toEqual(['fx-off']);
    expect(window.localStorage.getItem('pagewise.fx')).toBe('off');
    expect(screen.getByText('Keine Bewegung.')).toBeTruthy();

    await user.click(group.getByRole('radio', { name: 'Voll' }));
    expect(levels()).toEqual(['fx-full']);
    expect(window.localStorage.getItem('pagewise.fx')).toBe('full');

    await user.click(group.getByRole('radio', { name: 'Automatisch' }));
    expect(window.localStorage.getItem('pagewise.fx')).toBeNull();
  });

  it('zeigt die gespeicherte Wahl beim Öffnen', async () => {
    window.localStorage.setItem('pagewise.fx', 'reduced');
    openSettings();
    const group = within(await screen.findByRole('group', { name: 'Bewegung' }));
    await waitFor(() =>
      expect((group.getByRole('radio', { name: 'Reduziert' }) as HTMLInputElement).checked).toBe(
        true,
      ),
    );
  });

  it('der Umschalter für hell und dunkel arbeitet weiter', async () => {
    openSettings();
    const user = userEvent.setup();
    const group = within(await screen.findByRole('group', { name: 'Darstellung' }));
    await user.click(group.getByRole('radio', { name: 'Dunkel' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('wählt die Designrichtung, merkt sie sich und erklärt sie', async () => {
    openSettings();
    const user = userEvent.setup();
    const group = within(await screen.findByRole('group', { name: 'Designrichtung' }));
    // Voreinstellung: Raum
    expect((group.getByRole('radio', { name: 'Raum' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Ein Ordner mit Rücken und Heftung/)).toBeTruthy();

    await user.click(group.getByRole('radio', { name: 'Atelier' }));
    expect(document.documentElement.getAttribute('data-design')).toBe('atelier');
    expect(window.localStorage.getItem('pagewise.design')).toBe('atelier');
    expect(screen.getByText(/Klar und produktnah/)).toBeTruthy();

    await user.click(group.getByRole('radio', { name: 'Lagen' }));
    expect(document.documentElement.getAttribute('data-design')).toBe('lagen');
    expect(window.localStorage.getItem('pagewise.design')).toBe('lagen');
  });

  it('zeigt die gespeicherte Richtung beim Öffnen', async () => {
    window.localStorage.setItem('pagewise.design', 'lagen');
    openSettings();
    const group = within(await screen.findByRole('group', { name: 'Designrichtung' }));
    await waitFor(() =>
      expect((group.getByRole('radio', { name: 'Lagen' }) as HTMLInputElement).checked).toBe(true),
    );
  });
});
