// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ApiClient } from './api/client';
import type { ScanModel, ScanProposalView } from './api/types';
import { format, messages as m } from './i18n';
import { FakeServer, json } from './test/fake-server';

// jsdom kann keine Bilder zeichnen; der Schritt wird für die Oberflächentests ersetzt.
vi.mock('./planning/scan-image', () => ({
  MAX_CLIENT_IMAGE_BYTES: 20 * 1024 * 1024,
  MAX_SCAN_IMAGE_BYTES: 6 * 1024 * 1024,
  prepareImage: vi.fn(async () => new Blob(['erfundenes-bild'], { type: 'image/jpeg' })),
}));

const t = m.planning.timetableScan;
const MODEL: ScanModel = {
  providerId: 'anbieter-1',
  providerName: 'Beispiel-Anbieter',
  model: 'bild-modell',
  label: 'Beispiel-Anbieter · bild-modell',
  free: false,
};
const PROPOSAL: ScanProposalView = {
  weekday: 1,
  startTime: '08:00',
  endTime: '08:45',
  period: null,
  subject: 'Beispielfach A',
  subjectId: null,
  subjectState: 'new',
  room: 'Raum 1',
  note: null,
  week: 'all',
};

function open(server: FakeServer) {
  window.history.replaceState(null, '', '/timetable');
  return render(<App client={new ApiClient({ fetch: server.fetch })} />);
}

async function openDialog(server: FakeServer) {
  open(server);
  const user = userEvent.setup();
  expect(await screen.findByRole('heading', { name: 'Stundenplan', level: 1 })).toBeTruthy();
  await user.click(await screen.findByRole('button', { name: t.open }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  return { user, dialog };
}

const upload = (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) =>
  user.upload(
    within(dialog).getByLabelText(t.image),
    new File([new Uint8Array([1, 2, 3, 4])], 'beispiel.png', { type: 'image/png' }),
  );

/** Das Bild wird erst nach dem Neuzeichnen freigeschaltet. */
async function clickScan(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  const button = within(dialog).getByRole('button', { name: t.scan }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  await user.click(button);
}

beforeAll(async () => {
  await import('./screens/chat/ChatPage');
}, 30_000);

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  Object.defineProperty(URL, 'createObjectURL', {
    value: () => 'blob:beispiel',
    configurable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true });
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('Stundenplan aus Bild erkennen', () => {
  it('zeigt einen Leerzustand, wenn kein Modell Bilder lesen darf', async () => {
    const { dialog } = await openDialog(new FakeServer('unlocked'));
    expect(await within(dialog).findByText(t.noModels)).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: t.scan }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('meldet einen Ladefehler und kann die Modelle neu laden', async () => {
    const server = new FakeServer('unlocked');
    server.replyOnce('GET', '/api/timetable-scan/models', () => json(500, { error: 'unknown' }));
    server.scanModels = [MODEL];
    const { user, dialog } = await openDialog(server);
    expect(await within(dialog).findByText(t.modelsFailed)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: m.common.retry }));
    expect(await within(dialog).findByLabelText(t.model)).toBeTruthy();
  });

  it('erkennt Stunden, lässt Korrekturen zu und übernimmt erst auf Klick', async () => {
    const server = new FakeServer('unlocked');
    server.scanModels = [MODEL];
    server.scanResult = {
      proposals: [PROPOSAL],
      newSubjects: ['Beispielfach A'],
      skipped: 1,
    };
    const { user, dialog } = await openDialog(server);

    await upload(user, dialog);
    await waitFor(() =>
      expect(
        (within(dialog).getByRole('button', { name: t.scan }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(server.calls('POST', '/api/timetable-scan')).toHaveLength(0);
    await clickScan(user, dialog);

    const subject = (await within(dialog).findByLabelText(`${t.subject} 1`)) as HTMLInputElement;
    expect(subject.value).toBe('Beispielfach A');
    expect(
      within(dialog).getByText(format(t.newSubjects, { names: 'Beispielfach A' })),
    ).toBeTruthy();
    expect(within(dialog).getByText(format(t.skipped, { count: 1 }))).toBeTruthy();

    // Das Formular trägt Bild und Modellwahl, nicht die Vorschläge selbst.
    expect(server.lastScanForm?.get('providerId')).toBe(MODEL.providerId);
    expect(server.lastScanForm?.get('model')).toBe(MODEL.model);
    expect(server.lastScanForm?.get('image')).toBeTruthy();
    expect(server.calls('POST', '/api/timetable-scan/import')).toHaveLength(0);

    await user.clear(subject);
    await user.type(subject, 'Beispielfach B');
    await user.click(within(dialog).getByRole('button', { name: format(t.import, { count: 1 }) }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.calls('POST', '/api/timetable-scan/import')[0]?.body).toEqual({
      entries: [
        {
          weekday: 1,
          startTime: '08:00',
          endTime: '08:45',
          subject: 'Beispielfach B',
          room: 'Raum 1',
          note: null,
          week: 'all',
        },
      ],
      createSubjects: true,
      replaceExisting: false,
    });
    expect(await screen.findByText('08:00–08:45')).toBeTruthy();
  });

  it('zeigt einen Leerzustand, wenn das Modell keine Stunden erkennt', async () => {
    const server = new FakeServer('unlocked');
    server.scanModels = [MODEL];
    server.scanResult = { proposals: [], newSubjects: [], skipped: 0 };
    const { user, dialog } = await openDialog(server);
    await upload(user, dialog);
    await clickScan(user, dialog);
    expect(await within(dialog).findByText(t.emptyTitle)).toBeTruthy();
    expect(within(dialog).getByText(t.emptyHint)).toBeTruthy();
  });

  it('zeigt Fehler des Modells als verständlichen Text', async () => {
    const server = new FakeServer('unlocked');
    server.scanModels = [MODEL];
    server.scanError = 'provider_failed';
    const { user, dialog } = await openDialog(server);
    await upload(user, dialog);
    await clickScan(user, dialog);
    expect(await within(dialog).findByText(t.errors.providerFailed)).toBeTruthy();
    expect(server.calls('POST', '/api/timetable-scan/import')).toHaveLength(0);
  });

  it('wehrt eine fremde Dateiart schon im Browser ab', async () => {
    const server = new FakeServer('unlocked');
    server.scanModels = [MODEL];
    const { dialog } = await openDialog(server);
    fireEvent.change(within(dialog).getByLabelText(t.image), {
      target: { files: [new File(['text'], 'beispiel.txt', { type: 'text/plain' })] },
    });
    expect(await within(dialog).findByText(t.errors.fileType)).toBeTruthy();
    expect(server.calls('POST', '/api/timetable-scan')).toHaveLength(0);
  });

  it('lädt und speichert die Stundentafel', async () => {
    const server = new FakeServer('unlocked');
    server.scanModels = [MODEL];
    const { user, dialog } = await openDialog(server);
    await user.click(within(dialog).getByText(t.periodsTitle));
    const start = (await within(dialog).findByLabelText(`${t.from} 1`)) as HTMLInputElement;
    expect(start.value).toBe('08:00');
    fireEvent.change(start, { target: { value: '07:30' } });
    await user.click(within(dialog).getByRole('button', { name: t.periodsSave }));
    expect(await within(dialog).findByText(t.periodsSaved)).toBeTruthy();
    expect(server.calls('PUT', '/api/timetable-scan/periods')[0]?.body).toEqual({
      periods: [
        { period: 1, startTime: '07:30', endTime: '08:45' },
        { period: 2, startTime: '08:50', endTime: '09:35' },
      ],
    });
  });

  it('zeigt zugeordnete Stunden-Nummern und übernimmt ihre konkreten Zeiten', async () => {
    const server = new FakeServer('unlocked');
    server.scanModels = [MODEL];
    server.scanResult = { proposals: [{ ...PROPOSAL, period: 3 }], newSubjects: [], skipped: 0 };
    const { user, dialog } = await openDialog(server);
    await upload(user, dialog);
    await clickScan(user, dialog);
    expect(await within(dialog).findByText(t.periodsMapped)).toBeTruthy();
    expect(within(dialog).getByText(/Std\. 3/)).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: format(t.import, { count: 1 }) }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.calls('POST', '/api/timetable-scan/import')[0]?.body).toEqual({
      entries: [
        {
          weekday: 1,
          startTime: '08:00',
          endTime: '08:45',
          subject: 'Beispielfach A',
          room: 'Raum 1',
          note: null,
          week: 'all',
        },
      ],
      createSubjects: true,
      replaceExisting: false,
    });
  });
});
