// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { ApiClient } from '../api/client';
import { FakeServer } from '../test/fake-server';

/*
 * N1 (B-02, D-092): Im Dialog „Fach anlegen“ gehört jedem Register seine eigene Fläche. Das Register „Aus dem
 * Katalog“ zeigt nur die Auswahl mit ihrem Knopf „Fächer anlegen“; das Formular „Eigenes Fach“ samt klebender
 * Fußzeile (mit „Speichern“) kam bisher darunter mit heraus und stand als zweiter Speichern-Knopf am Dialogrand.
 * Beim Bearbeiten bleibt es beim einen Formular. Alle Namen sind erfunden.
 */

beforeAll(async () => {
  await import('./subjects/TemplatePicker');
}, 30_000);

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(cleanup);

function mount(server: FakeServer) {
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

async function openCreate() {
  const server = new FakeServer('unlocked');
  mount(server);
  const user = userEvent.setup();
  const [open] = await screen.findAllByRole('button', { name: /^Fach (anlegen|hinzufügen)$/ });
  await user.click(open as HTMLElement);
  const dialog = await screen.findByRole('dialog', { name: 'Fach anlegen' });
  await within(dialog).findByLabelText('Fach suchen');
  return { user, dialog, server };
}

describe('Fach anlegen: Register Katalog', () => {
  it('zeigt nur die Katalog-Auswahl, kein Formular und keinen zweiten Speichern-Knopf', async () => {
    const { dialog } = await openCreate();

    // Der eigene Knopf des Katalogs ist da, ein „Speichern“ aus dem anderen Register nicht.
    expect(within(dialog).getByRole('button', { name: 'Fächer anlegen' })).toBeTruthy();
    expect(within(dialog).queryAllByRole('button', { name: 'Speichern' })).toHaveLength(0);
    // Das Formular „Eigenes Fach“ steht gar nicht im DOM: weder sichtbar noch versteckt noch fokussierbar.
    expect(within(dialog).queryByLabelText('Name')).toBeNull();
    expect(dialog.querySelector('form')).toBeNull();
    expect(dialog.querySelector('.lg-dialog-foot')).toBeNull();
    expect(Array.from(dialog.querySelectorAll('button')).map((b) => b.textContent)).not.toContain(
      'Speichern',
    );
  });

  it('gibt der Suche den Anfangsfokus (BT1)', async () => {
    const { dialog } = await openCreate();
    const search = within(dialog).getByLabelText('Fach suchen');
    await waitFor(() => expect(document.activeElement).toBe(search));
  });
});

describe('Fach anlegen: Register Eigenes Fach', () => {
  it('zeigt das Formular mit genau einem Speichern-Knopf und blendet den Katalog aus', async () => {
    const { user, dialog } = await openCreate();
    await user.click(within(dialog).getByLabelText('Eigenes Fach'));

    expect(within(dialog).getByLabelText('Name')).toBeTruthy();
    expect(within(dialog).getAllByRole('button', { name: 'Speichern' })).toHaveLength(1);
    expect(dialog.querySelectorAll('.lg-dialog-foot')).toHaveLength(1);
    // Der Katalog bleibt montiert (Auswahl), ist aber versteckt: kein „Fächer anlegen“ erreichbar.
    expect(within(dialog).queryByRole('button', { name: 'Fächer anlegen' })).toBeNull();
    expect(within(dialog).getByLabelText('Fach suchen').closest('[hidden]')).not.toBeNull();
  });

  it('behält Name, Lehrkraft, Stunden, Symbol und Fehler beim Wechsel der Register', async () => {
    const { user, dialog } = await openCreate();
    await user.click(within(dialog).getByLabelText('Eigenes Fach'));
    // Erst ein Fehler, dann Eingaben.
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(within(dialog).getByText(/Namen mit 1 bis 80 Zeichen/)).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Name'), 'Beispielfach A');
    await user.type(within(dialog).getByLabelText(/Lehrkraft/), 'Beispiel-Lehrkraft');
    await user.type(within(dialog).getByLabelText(/Stunden pro Woche/), '3');
    await user.click(within(dialog).getByLabelText('Kolben'));

    await user.click(within(dialog).getByLabelText('Aus dem Katalog'));
    expect(within(dialog).queryByLabelText('Name')).toBeNull();
    await user.click(within(dialog).getByLabelText('Eigenes Fach'));

    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe(
      'Beispielfach A',
    );
    expect((within(dialog).getByLabelText(/Lehrkraft/) as HTMLInputElement).value).toBe(
      'Beispiel-Lehrkraft',
    );
    expect((within(dialog).getByLabelText(/Stunden pro Woche/) as HTMLInputElement).value).toBe(
      '3',
    );
    expect((within(dialog).getByLabelText('Kolben') as HTMLInputElement).checked).toBe(true);
  });

  it('legt nach dem Wechsel der Register das Fach mit den behaltenen Eingaben an', async () => {
    const { user, dialog, server } = await openCreate();
    await user.click(within(dialog).getByLabelText('Eigenes Fach'));
    await user.type(within(dialog).getByLabelText('Name'), 'Beispielfach A');
    await user.click(within(dialog).getByLabelText('Aus dem Katalog'));
    await user.click(within(dialog).getByLabelText('Eigenes Fach'));
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.calls('POST', '/api/subjects')[0]?.body).toMatchObject({
      name: 'Beispielfach A',
    });
  });
});

describe('Fach bearbeiten', () => {
  it('zeigt ein Formular mit einem Speichern-Knopf, ohne Register und ohne Katalog', async () => {
    const server = new FakeServer('unlocked');
    const subject = server.addSubject('Beispielfach A', { teacher: 'Beispiel-Lehrkraft' });
    window.history.replaceState(null, '', `/subjects/${subject.id}`);
    mount(server);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fach bearbeiten' });

    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe(
      'Beispielfach A',
    );
    expect(within(dialog).getAllByRole('button', { name: 'Speichern' })).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: 'Fach löschen' })).toBeTruthy();
    expect(within(dialog).queryByLabelText('Eigenes Fach')).toBeNull();
    expect(within(dialog).queryByLabelText('Fach suchen')).toBeNull();
    expect(dialog.querySelectorAll('form')).toHaveLength(1);
    expect(dialog.querySelectorAll('.lg-dialog-foot')).toHaveLength(1);
  });
});
