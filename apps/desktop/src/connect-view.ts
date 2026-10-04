import { format, messages as m } from './i18n';
import { NEUTRAL_HOSTNAME } from './tailscale/hostname';
import { type QrPath, qrPath } from './tailscale/qr';
import type { ActionFailure, Inspection } from './tailscale/service';

/**
 * Was das Verbindungsfenster zeigt. Das Fenster baut seine Anzeige aus diesem Objekt (nur mit `textContent`, nie mit
 * HTML): Texte kommen aus `i18n.ts`, nicht aus der Seite, und stehen hier fertig eingesetzt.
 */
export type ActionId =
  | 'setup-serve'
  | 'use-alt-port'
  | 'reset-serve'
  | 'rename-host'
  | 'copy-address'
  | 'open-tailscale'
  | 'open-admin-dns'
  | 'open-admin-machines'
  | 'open-download'
  | 'refresh';

export interface ConnectView {
  /** Schlüssel des Zustands (`served` = Freigabe steht). */
  stage: keyof typeof m.connect.states;
  title: string;
  body: string;
  address: string | null;
  qr: QrPath | null;
  warnings: Array<{
    id: 'funnel' | 'hostname' | 'foreign' | 'noPort';
    severity: 'danger' | 'warn';
    text: string;
  }>;
  actions: Array<{ id: ActionId; label: string }>;
  hostname: {
    label: string | null;
    suggestion: string;
    explain: string;
    buttonLabel: string;
  } | null;
  awakeNote: string;
  /** Ergebnis der letzten Aktion (Text), `null` ohne. */
  message: string | null;
  texts: {
    title: string;
    intro: string;
    addressLabel: string;
    qrLabel: string;
    howTo: string;
    hostLabel: string;
    hostnameLabel: string;
  };
}

export type MessageId = keyof typeof m.connect.results;

export interface ViewExtras {
  keepAwake: boolean;
  message?: MessageId | null;
}

const label = (
  id: ActionId,
  values: Record<string, string | number> = {},
): { id: ActionId; label: string } => ({
  id,
  label: format(m.connect.actions[id], values),
});

export function buildConnectView(inspection: Inspection, extras: ViewExtras): ConnectView {
  const stage: ConnectView['stage'] =
    inspection.state === 'running' && inspection.address ? 'served' : inspection.state;
  const state = m.connect.states[stage];
  const warnings: ConnectView['warnings'] = [];
  const actions: ConnectView['actions'] = [];
  const canRename = inspection.hostLabel !== null && inspection.state !== 'not-installed';

  if (inspection.funnel) {
    warnings.push({ id: 'funnel', severity: 'danger', text: m.connect.warnings.funnel });
    actions.push(label('reset-serve'));
  }
  if (inspection.hostnamePersonal && inspection.address === null) {
    warnings.push({
      id: 'hostname',
      severity: 'warn',
      text: format(m.connect.warnings.hostname, { name: inspection.hostLabel ?? '' }),
    });
  }

  switch (inspection.state) {
    case 'not-installed':
      actions.push(label('open-download'));
      break;
    case 'not-logged-in':
    case 'stopped':
    case 'starting':
      actions.push(label('open-tailscale'));
      break;
    case 'needs-approval':
      actions.push(label('open-admin-machines'));
      break;
    case 'https-disabled':
      actions.push(label('open-admin-dns'));
      break;
    case 'running': {
      if (inspection.address) {
        actions.push(label('copy-address'));
      } else if (inspection.proposedPort === 443) {
        actions.push(label('setup-serve'));
      } else if (inspection.proposedPort !== null) {
        warnings.push({
          id: 'foreign',
          severity: 'warn',
          text: format(m.connect.warnings.foreign, { port: inspection.proposedPort }),
        });
        actions.push(label('use-alt-port', { port: inspection.proposedPort }));
      } else {
        warnings.push({ id: 'noPort', severity: 'warn', text: m.connect.warnings.noPort });
      }
      break;
    }
  }
  actions.push(label('refresh'));

  const showHostname =
    canRename && (inspection.hostnamePersonal || inspection.state === 'https-disabled');
  return {
    stage,
    title: state.title,
    body: state.body,
    address: inspection.address,
    qr: inspection.address ? qrPath(inspection.address) : null,
    warnings,
    actions,
    hostname: showHostname
      ? {
          label: inspection.hostLabel,
          suggestion: NEUTRAL_HOSTNAME,
          explain: m.connect.hostnameExplain,
          buttonLabel: m.connect.actions['rename-host'],
        }
      : null,
    awakeNote: extras.keepAwake ? m.connect.awakeOn : m.connect.awakeOff,
    message: extras.message ? m.connect.results[extras.message] : null,
    texts: {
      title: m.connect.title,
      intro: m.connect.intro,
      addressLabel: m.connect.addressLabel,
      qrLabel: m.connect.qrLabel,
      howTo: m.connect.howTo,
      hostLabel: m.connect.hostLabel,
      hostnameLabel: m.connect.hostnameLabel,
    },
  };
}

export type { ActionFailure };
