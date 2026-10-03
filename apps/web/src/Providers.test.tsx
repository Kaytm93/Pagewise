// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import { FakeServer, json } from './test/fake-server';

// Fake-Schlüssel werden zur Laufzeit zusammengesetzt, damit der Secret-Scan den Quelltext nicht trifft.
const KEY = ['beispiel', 'schluessel', 'abcdefghijklmnop'].join('-');
const KEY_TWO = ['beispiel', 'schluessel', 'zyxwvutsrqponmlk'].join('-');

function mount(server: FakeServer) {
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

type User = ReturnType<typeof userEvent.setup>;

async function openSettings() {
  window.history.replaceState(null, '', '/settings');
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

async function addOpenRouter(user: User) {
  await user.click(await screen.findByRole('button', { name: 'Anbieter hinzufügen' }));
  const dialog = await screen.findByRole('dialog', { name: 'Anbieter hinzufügen' });
  await user.type(await within(dialog).findByLabelText(/API-Schlüssel/), KEY);
  await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('Anbieter in den Einstellungen', () => {
  it('startet ohne Anbieter mit einem klaren Hinweis', async () => {
    await openSettings();
    mount(new FakeServer('unlocked'));
    expect(await screen.findByText('Noch kein Anbieter eingetragen.')).toBeTruthy();
    expect(screen.queryByText('Standardmodell und Ausweichmodelle')).toBeNull();
  });

  it('legt OpenRouter mit den Standardmodellen an und zeigt den Schlüssel nie', async () => {
    await openSettings();
    const server = new FakeServer('unlocked');
    mount(server);
    const user = userEvent.setup();
    await addOpenRouter(user);

    const call = server.calls('POST', '/api/providers')[0];
    expect(call?.body).toMatchObject({
      name: 'OpenRouter',
      preset: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: KEY,
    });
    const sent = call?.body as { models: { id: string }[] } | undefined;
    expect(sent?.models.map((m) => m.id)).toEqual(['z-ai/glm-5.3-flash', 'openrouter/free']);

    expect(await screen.findByText('OpenRouter')).toBeTruthy();
    expect(
      screen.getByText(/openrouter\.ai · Schlüssel gespeichert, endet auf mnop · 2 Modelle/),
    ).toBeTruthy();
    // Der Schlüssel steht nirgends auf der Seite.
    expect(document.body.textContent).not.toContain(KEY);
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it('verlangt für OpenRouter einen Schlüssel und sendet ohne ihn nichts', async () => {
    await openSettings();
    const server = new FakeServer('unlocked');
    mount(server);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Anbieter hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(
      await within(dialog).findByText('Dieser Anbieter braucht einen Schlüssel.'),
    ).toBeTruthy();
    expect(server.calls('POST', '/api/providers')).toHaveLength(0);
  });

  it('legt einen zweiten, eigenen Anbieter ohne Code-Änderung an', async () => {
    await openSettings();
    const server = new FakeServer('unlocked');
    mount(server);
    const user = userEvent.setup();
    await addOpenRouter(user);

    await user.click(screen.getByRole('button', { name: 'Anbieter hinzufügen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Anbieter hinzufügen' });
    await user.selectOptions(await within(dialog).findByLabelText('Anbieter'), 'custom');
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe(
      'Eigener Anbieter',
    );
    expect((within(dialog).getByLabelText(/Adresse/) as HTMLInputElement).value).toBe('');

    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Zweiter Anbieter');
    await user.type(
      within(dialog).getByLabelText(/Adresse/),
      'https://zweiter-anbieter.example.test/v1',
    );
    await user.type(within(dialog).getByLabelText(/API-Schlüssel/), KEY_TWO);
    await user.type(within(dialog).getByLabelText('Modell hinzufügen'), 'zweit/modell{Enter}');
    expect(within(dialog).getAllByLabelText('Modell-Kennung')).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.providers.map((p) => [p.name, p.preset, p.baseUrl])).toEqual([
      ['OpenRouter', 'openrouter', 'https://openrouter.ai/api/v1'],
      ['Zweiter Anbieter', 'custom', 'https://zweiter-anbieter.example.test/v1'],
    ]);
    expect(server.providers[1]?.models.map((m) => m.id)).toEqual(['zweit/modell']);
    expect(document.body.innerHTML).not.toContain(KEY_TWO);
  });

  it('übernimmt beim Wechsel der Voreinstellung keinen Schlüssel mit', async () => {
    await openSettings();
    mount(new FakeServer('unlocked'));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Anbieter hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    const field = await within(dialog).findByLabelText(/API-Schlüssel/);
    await user.type(field, KEY);
    await user.selectOptions(within(dialog).getByLabelText('Anbieter'), 'ollama');
    expect((within(dialog).getByLabelText(/API-Schlüssel/) as HTMLInputElement).value).toBe('');
    expect((within(dialog).getByLabelText(/Adresse/) as HTMLInputElement).value).toBe(
      'http://localhost:11434/v1',
    );
  });

  it.each([
    ['http://anbieter.example.test/v1', 'Die Adresse muss mit https:// beginnen'],
    ['keine adresse', 'Das ist keine gültige Adresse.'],
  ])('zeigt Fehler der Adresse (%s)', async (url, message) => {
    await openSettings();
    mount(new FakeServer('unlocked'));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Anbieter hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(await within(dialog).findByLabelText('Anbieter'), 'custom');
    await user.type(within(dialog).getByLabelText(/Adresse/), url);
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByText(new RegExp(message))).toBeTruthy();
  });

  it('meldet einen doppelten Namen am Feld', async () => {
    await openSettings();
    const server = new FakeServer('unlocked');
    server.addProvider('OpenRouter');
    mount(server);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Anbieter hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(await within(dialog).findByLabelText(/API-Schlüssel/), KEY);
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(
      await within(dialog).findByText('Einen Anbieter mit diesem Namen gibt es schon.'),
    ).toBeTruthy();
  });

  it('weist bei Z.ai-Coding-Plan-Adressen auf die Regeln hin', async () => {
    await openSettings();
    mount(new FakeServer('unlocked'));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Anbieter hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(await within(dialog).findByLabelText('Anbieter'), 'custom');
    expect(within(dialog).queryByText(/Coding-Plan-Kontingent/)).toBeNull();
    await user.type(
      within(dialog).getByLabelText(/Adresse/),
      'https://api.z.ai/api/coding/paas/v4',
    );
    expect(
      within(dialog).getByText(/Coding-Plan-Kontingent nur in unterstützten Tools/),
    ).toBeTruthy();
  });

  it('warnt vor kostenlosen Modellen', async () => {
    await openSettings();
    mount(new FakeServer('unlocked'));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Anbieter hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText(/API-Schlüssel/);
    expect(
      within(dialog).getByText(/Kostenlose Modelle können Eingaben protokollieren/),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: '„openrouter/free“ entfernen' }));
    expect(
      within(dialog).queryByText(/Kostenlose Modelle können Eingaben protokollieren/),
    ).toBeNull();
  });

  it('lehnt ungültige und doppelte Modell-Kennungen ab', async () => {
    await openSettings();
    mount(new FakeServer('unlocked'));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Anbieter hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText(/API-Schlüssel/);
    const add = within(dialog).getByLabelText('Modell hinzufügen');
    await user.type(add, 'z-ai/glm-5.3-flash{Enter}');
    expect(await within(dialog).findByText('Diese Kennung gibt es schon.')).toBeTruthy();
    await user.clear(add);
    await user.type(add, 'mit leerzeichen{Enter}');
    expect(await within(dialog).findByText(/Eine Modell-Kennung ist ungültig/)).toBeTruthy();
    expect(within(dialog).getAllByLabelText('Modell-Kennung')).toHaveLength(2);
  });
});

describe('Anbieter bearbeiten, testen und löschen', () => {
  function seeded() {
    const server = new FakeServer('unlocked');
    const provider = server.addProvider('Zweiter Anbieter', {
      hasKey: true,
      keyHint: 'mnop',
      models: [
        {
          id: 'zweit/modell',
          vision: false,
          tools: false,
          reasoning: false,
          streaming: true,
          free: false,
        },
      ],
    });
    server.secrets.set(provider.id, KEY);
    return { server, provider };
  }

  async function openEdit(user: User) {
    await user.click(await screen.findByRole('button', { name: '„Zweiter Anbieter“ bearbeiten' }));
    return screen.findByRole('dialog', { name: 'Anbieter bearbeiten' });
  }

  it('zeigt den Schlüssel nie, nur seinen Zustand, und sendet bei unverändertem Schlüssel keinen', async () => {
    await openSettings();
    const { server, provider } = seeded();
    mount(server);
    const user = userEvent.setup();
    const dialog = await openEdit(user);
    expect((within(dialog).getByLabelText(/API-Schlüssel/) as HTMLInputElement).value).toBe('');
    expect(within(dialog).getByText(/Schlüssel gespeichert, endet auf mnop/)).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(KEY);

    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Umbenannt');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.calls('PATCH', `/api/providers/${provider.id}`)[0]?.body).toEqual({
      name: 'Umbenannt',
    });
    expect(await screen.findByText('Umbenannt')).toBeTruthy();
  });

  it('ersetzt den Schlüssel, ohne den alten zu zeigen', async () => {
    await openSettings();
    const { server, provider } = seeded();
    mount(server);
    const user = userEvent.setup();
    const dialog = await openEdit(user);
    await user.type(within(dialog).getByLabelText(/API-Schlüssel/), KEY_TWO);
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.calls('PATCH', `/api/providers/${provider.id}`)[0]?.body).toEqual({
      apiKey: KEY_TWO,
    });
    expect(server.secrets.get(provider.id)).toBe(KEY_TWO);
    expect(document.body.innerHTML).not.toContain(KEY_TWO);
  });

  it('entfernt den Schlüssel auf Wunsch und lässt sich das noch umentscheiden', async () => {
    await openSettings();
    const { server, provider } = seeded();
    mount(server);
    const user = userEvent.setup();
    const dialog = await openEdit(user);
    await user.click(
      within(dialog).getByRole('button', { name: 'Gespeicherten Schlüssel entfernen' }),
    );
    expect(within(dialog).getByText('Der Schlüssel wird beim Speichern entfernt.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Behalten' }));
    expect(within(dialog).queryByText('Der Schlüssel wird beim Speichern entfernt.')).toBeNull();
    await user.click(
      within(dialog).getByRole('button', { name: 'Gespeicherten Schlüssel entfernen' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.calls('PATCH', `/api/providers/${provider.id}`)[0]?.body).toEqual({
      clearKey: true,
    });
    expect(server.secrets.has(provider.id)).toBe(false);
  });

  it('schließt ohne Anfrage, wenn nichts geändert wurde', async () => {
    await openSettings();
    const { server, provider } = seeded();
    mount(server);
    const user = userEvent.setup();
    const dialog = await openEdit(user);
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.calls('PATCH', `/api/providers/${provider.id}`)).toHaveLength(0);
  });

  it('testet die Verbindung und nennt Erfolg und Fehler verständlich', async () => {
    await openSettings();
    const { server } = seeded();
    mount(server);
    const user = userEvent.setup();
    const dialog = await openEdit(user);

    server.testOutcome = { ok: true, latencyMs: 87, modelCount: 12 };
    await user.click(within(dialog).getByRole('button', { name: 'Verbindung testen' }));
    expect(
      await within(dialog).findByText('Verbindung steht (87 ms), 12 Modelle verfügbar.'),
    ).toBeTruthy();

    server.testOutcome = { ok: false, code: 'auth_failed' };
    await user.click(within(dialog).getByRole('button', { name: 'Verbindung testen' }));
    expect(await within(dialog).findByText('Der Anbieter lehnt den Schlüssel ab.')).toBeTruthy();

    server.testOutcome = { ok: false, code: 'etwas_neues' };
    await user.click(within(dialog).getByRole('button', { name: 'Verbindung testen' }));
    expect(await within(dialog).findByText('Die Prüfung ist fehlgeschlagen.')).toBeTruthy();
  });

  it('lädt die Modelle vom Anbieter, filtert und übernimmt sie mit ihren Fähigkeiten', async () => {
    await openSettings();
    const { server, provider } = seeded();
    server.available = [
      { id: 'zweit/modell', name: null, vision: null, tools: null, reasoning: null, free: false },
      { id: 'zweit/bild', name: null, vision: true, tools: true, reasoning: null, free: false },
      {
        id: 'zweit/gratis:free',
        name: null,
        vision: false,
        tools: false,
        reasoning: false,
        free: true,
      },
    ];
    mount(server);
    const user = userEvent.setup();
    const dialog = await openEdit(user);
    await user.click(within(dialog).getByRole('button', { name: 'Vom Anbieter laden' }));
    await user.type(await within(dialog).findByLabelText('Liste filtern'), 'bild');
    expect(within(dialog).queryByText('zweit/gratis:free')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: '„zweit/bild“ übernehmen' }));
    expect(within(dialog).getAllByLabelText('Modell-Kennung')).toHaveLength(2);
    // Schon Übernommenes lässt sich nicht noch einmal übernehmen.
    await user.clear(within(dialog).getByLabelText('Liste filtern'));
    expect(
      (
        within(dialog).getByRole('button', {
          name: '„zweit/modell“ übernehmen',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.calls('PATCH', `/api/providers/${provider.id}`)[0]?.body).toEqual({
      models: [
        { id: 'zweit/modell', vision: false, tools: false, reasoning: false, streaming: true },
        { id: 'zweit/bild', vision: true, tools: true, reasoning: false, streaming: true },
      ],
    });
  });

  it('meldet, wenn die Modellliste nicht geladen werden kann', async () => {
    await openSettings();
    const { server, provider } = seeded();
    server.replyOnce('GET', `/api/providers/${provider.id}/available-models`, () =>
      json(502, { error: 'provider_failed', code: 'unreachable' }),
    );
    mount(server);
    const user = userEvent.setup();
    const dialog = await openEdit(user);
    await user.click(within(dialog).getByRole('button', { name: 'Vom Anbieter laden' }));
    expect(await within(dialog).findByText('Die Liste konnte nicht geladen werden.')).toBeTruthy();
  });

  it('löscht erst nach Rückfrage', async () => {
    await openSettings();
    const { server } = seeded();
    mount(server);
    const user = userEvent.setup();
    const dialog = await openEdit(user);
    await user.click(within(dialog).getByRole('button', { name: 'Anbieter löschen' }));
    const confirm = await screen.findByRole('dialog', {
      name: 'Anbieter „Zweiter Anbieter“ löschen?',
    });
    await user.click(within(confirm).getByRole('button', { name: 'Abbrechen' }));
    expect(server.providers).toHaveLength(1);

    await user.click(within(dialog).getByRole('button', { name: 'Anbieter löschen' }));
    const again = await screen.findByRole('dialog', {
      name: 'Anbieter „Zweiter Anbieter“ löschen?',
    });
    await user.click(within(again).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(server.providers).toHaveLength(0));
    expect(server.secrets.size).toBe(0);
    expect(await screen.findByText('Noch kein Anbieter eingetragen.')).toBeTruthy();
  });
});

describe('Standardmodell und Ausweichmodelle', () => {
  function withModels() {
    const server = new FakeServer('unlocked');
    const first = server.addProvider('Anbieter Eins', {
      models: [
        {
          id: 'eins/a',
          vision: false,
          tools: false,
          reasoning: false,
          streaming: true,
          free: false,
        },
        {
          id: 'eins/gratis:free',
          vision: false,
          tools: false,
          reasoning: false,
          streaming: true,
          free: true,
        },
      ],
    });
    const second = server.addProvider('Anbieter Zwei', {
      models: [
        {
          id: 'zwei/b',
          vision: false,
          tools: false,
          reasoning: false,
          streaming: true,
          free: false,
        },
      ],
    });
    return { server, first, second };
  }

  it('erklärt, was zuerst fehlt, wenn es noch keine Modelle gibt', async () => {
    await openSettings();
    const server = new FakeServer('unlocked');
    server.addProvider('Ohne Modelle');
    mount(server);
    expect(
      await screen.findByText('Trag zuerst einen Anbieter mit mindestens einem Modell ein.'),
    ).toBeTruthy();
  });

  it('speichert Standardmodell und Kette und kennzeichnet kostenlose Modelle', async () => {
    await openSettings();
    const { server, first, second } = withModels();
    mount(server);
    const user = userEvent.setup();

    const standard = await screen.findByLabelText('Standardmodell');
    expect(
      within(standard).getByRole('option', {
        name: 'Anbieter Eins · eins/gratis:free · kostenlos',
      }),
    ).toBeTruthy();
    await user.selectOptions(standard, `${second.id}|zwei/b`);
    await user.click(screen.getByRole('button', { name: 'Ausweichmodell hinzufügen' }));
    await user.selectOptions(screen.getByLabelText('Ausweichmodell 1'), `${first.id}|eins/a`);
    await user.click(screen.getByRole('button', { name: 'Auswahl speichern' }));

    expect(await screen.findByText('Gespeichert.')).toBeTruthy();
    expect(server.modelSettings).toEqual({
      default: { providerId: second.id, model: 'zwei/b' },
      fallback: [{ providerId: first.id, model: 'eins/a' }],
    });
  });

  it('begrenzt die Kette und lässt Einträge wieder entfernen', async () => {
    await openSettings();
    const { server } = withModels();
    mount(server);
    const user = userEvent.setup();
    for (let i = 0; i < 5; i += 1) {
      await user.click(await screen.findByRole('button', { name: 'Ausweichmodell hinzufügen' }));
    }
    expect(screen.queryByRole('button', { name: 'Ausweichmodell hinzufügen' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ausweichmodell 5 entfernen' }));
    expect(screen.getByRole('button', { name: 'Ausweichmodell hinzufügen' })).toBeTruthy();
  });

  it('übernimmt den aufgeräumten Stand, wenn ein Anbieter gelöscht wird', async () => {
    await openSettings();
    const { server, first, second } = withModels();
    server.modelSettings = {
      default: { providerId: second.id, model: 'zwei/b' },
      fallback: [{ providerId: first.id, model: 'eins/a' }],
    };
    mount(server);
    const user = userEvent.setup();
    const standard = (await screen.findByLabelText('Standardmodell')) as HTMLSelectElement;
    expect(standard.value).toBe(`${second.id}|zwei/b`);

    await user.click(screen.getByRole('button', { name: '„Anbieter Zwei“ bearbeiten' }));
    const dialog = await screen.findByRole('dialog', { name: 'Anbieter bearbeiten' });
    await user.click(within(dialog).getByRole('button', { name: 'Anbieter löschen' }));
    const confirm = await screen.findByRole('dialog', {
      name: 'Anbieter „Anbieter Zwei“ löschen?',
    });
    await user.click(within(confirm).getByRole('button', { name: 'Löschen' }));

    await waitFor(() =>
      expect((screen.getByLabelText('Standardmodell') as HTMLSelectElement).value).toBe(''),
    );
  });
});
