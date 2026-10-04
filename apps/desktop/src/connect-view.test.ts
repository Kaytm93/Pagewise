import { describe, expect, it } from 'vitest';
import { buildConnectView } from './connect-view';
import { QR_PATH_PATTERN } from './tailscale/qr';
import type { Inspection } from './tailscale/service';

const BASE: Inspection = {
  state: 'running',
  cliPath: '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  dnsName: 'pagewise-mac.tail0000.ts.net',
  hostLabel: 'pagewise-mac',
  serve: { ours: null, foreign: [], funnel: false },
  servePort: null,
  address: null,
  funnel: false,
  hostnamePersonal: false,
  proposedPort: 443,
  conflictOn443: false,
};
const view = (
  patch: Partial<Inspection> = {},
  keepAwake = true,
  message: Parameters<typeof buildConnectView>[1]['message'] = null,
) => buildConnectView({ ...BASE, ...patch }, { keepAwake, message });
const ids = (v: ReturnType<typeof view>) => v.actions.map((a) => a.id);

describe('Verbindungsfenster: Ansicht je Zustand', () => {
  it('nicht installiert: Download anbieten', () => {
    const v = view({
      state: 'not-installed',
      cliPath: null,
      dnsName: null,
      hostLabel: null,
      serve: null,
      proposedPort: null,
    });
    expect(v.stage).toBe('not-installed');
    expect(v.title).toBe('Tailscale ist nicht installiert');
    expect(ids(v)).toEqual(['open-download', 'refresh']);
    expect(v.address).toBeNull();
    expect(v.qr).toBeNull();
    expect(v.hostname).toBeNull();
  });

  it('nicht angemeldet, ausgeschaltet, startet: Tailscale öffnen', () => {
    for (const state of ['not-logged-in', 'stopped', 'starting'] as const) {
      expect(ids(view({ state, serve: null, proposedPort: null })), state).toEqual([
        'open-tailscale',
        'refresh',
      ]);
    }
  });

  it('wartet auf Freigabe: Verwaltung (Rechner) öffnen', () => {
    expect(ids(view({ state: 'needs-approval', serve: null, proposedPort: null }))).toEqual([
      'open-admin-machines',
      'refresh',
    ]);
  });

  it('HTTPS aus: Verwaltung (DNS) öffnen und Warnung zum öffentlichen Verzeichnis im Text', () => {
    const v = view({ state: 'https-disabled', serve: null, proposedPort: null });
    expect(ids(v)).toEqual(['open-admin-dns', 'refresh']);
    expect(v.body).toContain('öffentlichen Zertifikatsverzeichnis');
  });

  it('läuft ohne Freigabe: „Freigabe einrichten“', () => {
    const v = view();
    expect(v.stage).toBe('running');
    expect(ids(v)).toEqual(['setup-serve', 'refresh']);
    expect(v.address).toBeNull();
    expect(v.warnings).toEqual([]);
  });

  it('Freigabe steht: Adresse, QR-Code als reiner Pfad, Hinweis zu Safari und Teilen', () => {
    const v = view({
      address: 'https://pagewise-mac.tail0000.ts.net',
      servePort: 443,
      proposedPort: null,
    });
    expect(v.stage).toBe('served');
    expect(v.address).toBe('https://pagewise-mac.tail0000.ts.net');
    expect(ids(v)).toEqual(['copy-address', 'refresh']);
    expect(v.qr?.size).toBeGreaterThan(20);
    expect(QR_PATH_PATTERN.test(v.qr?.path ?? '!')).toBe(true);
    expect(v.texts.howTo).toContain('Safari');
    expect(v.texts.howTo).toContain('Zum Home-Bildschirm');
  });

  it('fremde Freigabe auf 443: Warnung und Angebot für den Ausweichport, nie Überschreiben', () => {
    const v = view({
      proposedPort: 8443,
      conflictOn443: true,
      serve: {
        ours: null,
        foreign: [{ port: 443, targets: ['http://127.0.0.1:9'] }],
        funnel: false,
      },
    });
    expect(v.warnings).toHaveLength(1);
    expect(v.warnings[0]).toMatchObject({ id: 'foreign', severity: 'warn' });
    expect(v.warnings[0]?.text).toContain('Port 8443');
    expect(v.warnings[0]?.text).toContain('überschreibt sie nie');
    expect(v.actions.find((a) => a.id === 'use-alt-port')?.label).toBe('Auf Port 8443 einrichten');
    expect(ids(v)).not.toContain('setup-serve');
  });

  it('alle Ports belegt: Warnung ohne Einrichten', () => {
    const v = view({ proposedPort: null });
    expect(v.warnings[0]).toMatchObject({ id: 'noPort' });
    expect(ids(v)).toEqual(['refresh']);
  });

  it('Funnel: rote Warnung ganz oben und „Freigabe zurücksetzen“', () => {
    const v = view({
      funnel: true,
      address: 'https://pagewise-mac.tail0000.ts.net',
      servePort: 443,
      proposedPort: null,
    });
    expect(v.warnings[0]).toMatchObject({ id: 'funnel', severity: 'danger' });
    expect(v.warnings[0]?.text).toContain('öffentlich im Internet');
    expect(ids(v)[0]).toBe('reset-serve');
  });

  it('Funnel wird auch ohne unsere Freigabe gemeldet', () => {
    expect(view({ funnel: true }).warnings.map((w) => w.id)).toContain('funnel');
  });

  it('Rechnername wirkt personenbezogen: Warnung mit Name und Formular für einen neutralen Namen', () => {
    const v = view({ hostnamePersonal: true, hostLabel: 'kays-macbook-pro' });
    expect(v.warnings[0]).toMatchObject({ id: 'hostname', severity: 'warn' });
    expect(v.warnings[0]?.text).toContain('„kays-macbook-pro“');
    expect(v.warnings[0]?.text).toContain('Certificate Transparency');
    expect(v.hostname).toMatchObject({
      label: 'kays-macbook-pro',
      suggestion: 'pagewise-mac',
      buttonLabel: 'Rechnernamen ändern',
    });
    expect(v.hostname?.explain).toContain('Adresse');
    expect(v.hostname?.explain).toContain('neu an');
  });

  it('bei HTTPS aus gibt es das Namensformular auch ohne Verdacht (vorher umbenennen)', () => {
    expect(
      view({ state: 'https-disabled', serve: null, proposedPort: null }).hostname,
    ).not.toBeNull();
    expect(view().hostname).toBeNull();
  });

  it('zeigt die Warnung zum Namen nicht mehr, wenn die Freigabe schon steht', () => {
    const v = view({
      hostnamePersonal: true,
      address: 'https://x.ts.net',
      servePort: 443,
      proposedPort: null,
    });
    expect(v.warnings.map((w) => w.id)).not.toContain('hostname');
  });

  it('erklärt ehrlich das Wachhalten (mit und ohne), samt Deckel-Hinweis', () => {
    expect(view({}, true).awakeNote).toContain('zugeklapptem Deckel');
    expect(view({}, false).awakeNote).toContain('nicht wach gehalten');
  });

  it('gibt das Ergebnis der letzten Aktion als Text zurück', () => {
    expect(view({}, true, 'ok').message).toBe('Erledigt.');
    expect(view({}, true, 'timeout').message).toContain('nicht rechtzeitig');
    expect(view({}, true, null).message).toBeNull();
  });

  it('enthält nie rohe Ausgaben von Tailscale, nur eigene Texte', () => {
    const text = JSON.stringify(view({ funnel: true, hostnamePersonal: true }));
    expect(text).not.toMatch(/<|>|Proxy|BackendState|stderr/);
  });
});
