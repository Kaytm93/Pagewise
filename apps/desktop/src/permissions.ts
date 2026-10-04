/**
 * Alle Berechtigungsanfragen der Seiten (Kamera, Mikrofon, Benachrichtigungen, Standort, Geräte) werden abgelehnt.
 * Pagewise braucht keine davon im Fenster (Fotos kommen mit 1c über Dateiwahl, nicht über `getUserMedia`).
 */
export interface PermissionSession {
  setPermissionRequestHandler(
    handler: (
      webContents: unknown,
      permission: string,
      callback: (granted: boolean) => void,
    ) => void,
  ): void;
  setPermissionCheckHandler(handler: (webContents: unknown, permission: string) => boolean): void;
  setDevicePermissionHandler(handler: (details: unknown) => boolean): void;
}

export function installPermissionPolicy(session: PermissionSession): void {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
}
