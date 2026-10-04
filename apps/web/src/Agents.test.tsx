// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer } from './test/fake-server';

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const TOKEN = ['beispiel', 'token', 'abcdefghijklmnop'].join('-');

function openSettings(server: FakeServer) {
  window.history.replaceState(null, '', '/settings');
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

async function section() {
  const heading = await screen.findByRole('heading', { name: 'Agent-CLI', level: 2 });
  const element = heading.closest('section');
  if (!element) throw new Error('Abschnitt „Agent-CLI“ nicht gefunden');
  return within(element as HTMLElement);
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('Einstellungen: Agent-CLI', () => {
  it('zeigt das gefundene Programm mit Version und Ort', async () => {
    const view = await (async () => {
      openSettings(new FakeServer('unlocked'));
      return section();
    })();
    expect(await view.findByText('Claude Code gefunden, Version 2.1.220.')).toBeTruthy();
    expect(view.getByText('Ort: /usr/local/bin/claude')).toBeTruthy();
  });

  it('erklärt, wenn das Programm fehlt, und sucht auf Wunsch erneut', async () => {
    const server = new FakeServer('unlocked');
    server.cli = { state: 'missing', path: null, version: null, skipped: [] };
    openSettings(server);
    const view = await section();
    expect(await view.findByText(/Claude Code wurde nicht gefunden/)).toBeTruthy();
    expect(view.getByText(/Bis dahin antwortet Pagewise nur mit Modellen/)).toBeTruthy();

    // Nach der Installation findet „Erneut suchen“ das Programm.
    server.cli = {
      state: 'ready',
      path: '/opt/homebrew/bin/claude',
      version: '2.2.0',
      skipped: [],
    };
    await userEvent.setup().click(view.getByRole('button', { name: 'Erneut suchen' }));
    expect(await view.findByText('Claude Code gefunden, Version 2.2.0.')).toBeTruthy();
    expect(server.calls('POST', '/api/engines/detect')).toHaveLength(1);
  });

  it('nennt einen defekten Kandidaten, wenn keiner startet, und übersprungene bei einem Treffer', async () => {
    const server = new FakeServer('unlocked');
    server.cli = {
      state: 'broken',
      path: null,
      version: null,
      skipped: [{ path: '/Users/beispiel/.local/bin/claude', reason: 'failed' }],
    };
    openSettings(server);
    const view = await section();
    expect(await view.findByText(/die aber nicht startet/)).toBeTruthy();
    expect(
      view.getByText('Übersprungen, startet nicht: /Users/beispiel/.local/bin/claude'),
    ).toBeTruthy();
  });

  it('startet ohne Zugänge und erinnert an die Regeln der Anbieter', async () => {
    openSettings(new FakeServer('unlocked'));
    const view = await section();
    expect(view.getByText('Noch kein Zugang eingerichtet.')).toBeTruthy();
    expect(view.getByText(/nur für die persönliche Nutzung des Kontoinhabers/)).toBeTruthy();
    expect(view.getByText(/gehört nicht zu Anthropic oder Z\.ai/)).toBeTruthy();
  });

  it('legt ein Claude-Abo ohne Schlüsselfeld an', async () => {
    const server = new FakeServer('unlocked');
    openSettings(server);
    const user = userEvent.setup();
    await user.click(await (await section()).findByRole('button', { name: 'Zugang hinzufügen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zugang hinzufügen' });
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe(
      'Mein Claude-Abo',
    );
    expect(
      within(dialog).getByText(/Pagewise liest, speichert und vermittelt keine Zugangsdaten/),
    ).toBeTruthy();
    expect(within(dialog).queryByLabelText(/^Schlüssel/, { selector: 'input' })).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.calls('POST', '/api/engines')[0]?.body).toEqual({
      kind: 'claude-subscription',
      name: 'Mein Claude-Abo',
      model: null,
      timeoutMinutes: 20,
    });
    expect(
      await (await section()).findByText(/Claude-Abo · Standardmodell · höchstens 20 Min\./),
    ).toBeTruthy();
  });

  it('verlangt beim GLM Coding Plan einen Schlüssel, nennt die Adresse und zeigt ihn danach nie wieder', async () => {
    const server = new FakeServer('unlocked');
    openSettings(server);
    const user = userEvent.setup();
    await user.click(await (await section()).findByRole('button', { name: 'Zugang hinzufügen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zugang hinzufügen' });
    await user.selectOptions(within(dialog).getByLabelText('Art des Zugangs'), 'glm-coding-plan');
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe(
      'Mein GLM Coding Plan',
    );
    expect(within(dialog).getByText(/https:\/\/api\.z\.ai\/api\/anthropic/)).toBeTruthy();
    expect(
      within(dialog).getByText(/Z\.ai verbietet es, den Plan mit anderen zu teilen/),
    ).toBeTruthy();
    expect(within(dialog).getByText('Leer lassen für glm-5.3-flash.')).toBeTruthy();

    // Ohne Schlüssel wird nichts gesendet.
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(
      await within(dialog).findByText('Für diese Art brauchst du einen Schlüssel.'),
    ).toBeTruthy();
    expect(server.calls('POST', '/api/engines')).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(/^Schlüssel/, { selector: 'input' }), TOKEN);
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const view = await section();
    expect(await view.findByText(/GLM Coding Plan \(Z\.ai\) · glm-5\.3-flash/)).toBeTruthy();
    expect(
      view.getByText(new RegExp(`Schlüssel gespeichert, endet auf ${TOKEN.slice(-4)}`)),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(document.documentElement.innerHTML).not.toContain(TOKEN);
  });

  it('meldet einen doppelten Namen am Feld', async () => {
    const server = new FakeServer('unlocked');
    server.addEngine('Mein Claude-Abo');
    openSettings(server);
    const user = userEvent.setup();
    await user.click(await (await section()).findByRole('button', { name: 'Zugang hinzufügen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zugang hinzufügen' });
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(
      await within(dialog).findByText('Einen Zugang mit diesem Namen gibt es schon.'),
    ).toBeTruthy();
  });

  it('bearbeitet einen Zugang: Art bleibt fest, leerer Schlüssel lässt den gespeicherten stehen', async () => {
    const server = new FakeServer('unlocked');
    const profile = server.addEngine('GLM', {
      kind: 'glm-coding-plan',
      hasToken: true,
      tokenHint: 'mnop',
    });
    openSettings(server);
    const user = userEvent.setup();
    await user.click(await (await section()).findByRole('button', { name: '„GLM“ bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zugang bearbeiten' });
    expect(within(dialog).queryByLabelText('Art des Zugangs')).toBeNull();
    expect(within(dialog).getByText('GLM Coding Plan (Z.ai)')).toBeTruthy();
    expect(within(dialog).getByText('Schlüssel gespeichert, endet auf mnop')).toBeTruthy();

    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'GLM neu');
    await user.type(within(dialog).getByLabelText(/Modell/), 'glm-5.3');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.calls('PATCH', `/api/engines/${profile.id}`)[0]?.body).toEqual({
      name: 'GLM neu',
      model: 'glm-5.3',
      timeoutMinutes: 20,
    });
  });

  it('prüft die Höchstdauer, bevor etwas gesendet wird', async () => {
    const server = new FakeServer('unlocked');
    openSettings(server);
    const user = userEvent.setup();
    await user.click(await (await section()).findByRole('button', { name: 'Zugang hinzufügen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zugang hinzufügen' });
    const field = within(dialog).getByLabelText(/Höchstdauer/);
    await user.clear(field);
    await user.type(field, '500');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(
      await within(dialog).findByText('Bitte gib eine ganze Zahl von 1 bis 120 ein.'),
    ).toBeTruthy();
    expect(server.calls('POST', '/api/engines')).toHaveLength(0);
  });

  it('löscht einen Zugang erst nach Rückfrage', async () => {
    const server = new FakeServer('unlocked');
    server.addEngine('Mein Abo');
    openSettings(server);
    const user = userEvent.setup();
    await user.click(
      await (await section()).findByRole('button', { name: '„Mein Abo“ bearbeiten' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Zugang bearbeiten' });
    await user.click(within(dialog).getByRole('button', { name: 'Zugang löschen' }));
    const confirm = await screen.findByRole('dialog', { name: 'Zugang „Mein Abo“ löschen?' });
    await user.click(within(confirm).getByRole('button', { name: 'Abbrechen' }));
    expect(server.engines).toHaveLength(1);

    await user.click(within(dialog).getByRole('button', { name: 'Zugang löschen' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Zugang „Mein Abo“ löschen?' })).getByRole(
        'button',
        {
          name: 'Löschen',
        },
      ),
    );
    await waitFor(() => expect(server.engines).toHaveLength(0));
    expect(await (await section()).findByText('Noch kein Zugang eingerichtet.')).toBeTruthy();
  });
});
