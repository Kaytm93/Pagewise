import { buildConnectView, type ConnectView, type MessageId } from './connect-view';
import { format, messages as m } from './i18n';
import { isValidHostLabel } from './tailscale/hostname';
import type { ActionResult, Inspection } from './tailscale/service';

/**
 * Die Aktionen des Verbindungsfensters. Alles, was etwas verändert (Freigabe einrichten, zurücksetzen, Rechner
 * umbenennen), fragt vorher in einem Dialog des Hauptprozesses nach, wo es Folgen hat. Die Seite selbst bekommt nur
 * feste Funktionen (siehe `preload.ts`) und nie die Möglichkeit, Befehle oder Adressen vorzugeben.
 */
export interface ConnectDeps {
  tailscale: {
    inspect(): Promise<Inspection>;
    setupServe(request?: { httpsPort?: number }): Promise<ActionResult>;
    resetServe(): Promise<ActionResult>;
    renameHost(label: string): Promise<ActionResult>;
  };
  confirm(request: { title: string; detail: string; confirmLabel: string }): Promise<boolean>;
  copy(text: string): void;
  openExternal(url: string): void;
  openPath(path: string): void;
  keepAwake(): boolean;
  /** Merkt, dass die Person die Freigabe eingerichtet hat (die App prüft sie dann beim Start). */
  rememberServe(enabled: boolean): void;
  /** Der Zustand hat sich geändert (Adresse für das Menüleisten-Symbol). */
  changed(inspection: Inspection): void;
  urls: { download: string; adminDns: string; adminMachines: string; appPath: string };
}

export class ConnectController {
  constructor(private readonly deps: ConnectDeps) {}

  private async view(message: MessageId | null = null): Promise<ConnectView> {
    const inspection = await this.deps.tailscale.inspect();
    this.deps.changed(inspection);
    return buildConnectView(inspection, { keepAwake: this.deps.keepAwake(), message });
  }

  getView(): Promise<ConnectView> {
    return this.view();
  }

  private async after(result: ActionResult, onOk?: () => void): Promise<ConnectView> {
    if (result.ok) {
      onOk?.();
      this.deps.changed(result.inspection);
      return buildConnectView(result.inspection, {
        keepAwake: this.deps.keepAwake(),
        message: 'ok',
      });
    }
    return this.view(result.reason);
  }

  /** Richtet die Freigabe ein. Wirkt der Rechnername personenbezogen, fragt die App vorher nach. */
  async setupServe(useAlternatePort: boolean): Promise<ConnectView> {
    const inspection = await this.deps.tailscale.inspect();
    if (inspection.hostnamePersonal && !inspection.address) {
      const confirmed = await this.deps.confirm({
        title: m.connect.confirm.hostnameTitle,
        detail: format(m.connect.confirm.hostnameDetail, { name: inspection.hostLabel ?? '' }),
        confirmLabel: m.connect.confirm.hostnameAnyway,
      });
      if (!confirmed) return this.view('cancelled');
    }
    const port = useAlternatePort ? (inspection.proposedPort ?? undefined) : undefined;
    return this.after(
      await this.deps.tailscale.setupServe(port === undefined ? {} : { httpsPort: port }),
      () => this.deps.rememberServe(true),
    );
  }

  async resetServe(): Promise<ConnectView> {
    const confirmed = await this.deps.confirm({
      title: m.connect.confirm.resetTitle,
      detail: m.connect.confirm.resetDetail,
      confirmLabel: m.connect.confirm.resetConfirm,
    });
    if (!confirmed) return this.view('cancelled');
    return this.after(await this.deps.tailscale.resetServe(), () => this.deps.rememberServe(false));
  }

  async renameHost(name: unknown): Promise<ConnectView> {
    if (typeof name !== 'string' || !isValidHostLabel(name)) return this.view('invalid-name');
    const confirmed = await this.deps.confirm({
      title: m.connect.confirm.renameTitle,
      detail: format(m.connect.confirm.renameDetail, { name }),
      confirmLabel: m.connect.confirm.renameConfirm,
    });
    if (!confirmed) return this.view('cancelled');
    return this.after(await this.deps.tailscale.renameHost(name));
  }

  async copyAddress(): Promise<ConnectView> {
    const inspection = await this.deps.tailscale.inspect();
    if (inspection.address) this.deps.copy(inspection.address);
    this.deps.changed(inspection);
    return buildConnectView(inspection, {
      keepAwake: this.deps.keepAwake(),
      message: inspection.address ? 'copied' : null,
    });
  }

  openTailscale(): void {
    this.deps.openPath(this.deps.urls.appPath);
  }

  openAdmin(kind: 'dns' | 'machines'): void {
    this.deps.openExternal(kind === 'dns' ? this.deps.urls.adminDns : this.deps.urls.adminMachines);
  }

  openDownload(): void {
    this.deps.openExternal(this.deps.urls.download);
  }
}
