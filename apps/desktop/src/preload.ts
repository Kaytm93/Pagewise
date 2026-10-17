import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from './ipc';

// Preload der Hüllen-Fenster (nicht des Hauptfensters mit der Oberfläche des Servers). Nur diese Funktionen, fest
// benannt, jede mit eigenem Kanal. Nichts davon nimmt einen Kanalnamen oder Code von der Seite entgegen.
contextBridge.exposeInMainWorld(
  'pagewise',
  Object.freeze({
    getStatus: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.getStatus),
    // Verbindungsfenster: jede Funktion hat ihren eigenen Kanal, der Hauptprozess prüft Absender und Eingabe.
    getView: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.getConnectView),
    setupServe: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.setupServe),
    useAltPort: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.useAltPort),
    resetServe: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.resetServe),
    renameHost: (name: string): Promise<unknown> =>
      ipcRenderer.invoke(CHANNELS.renameHost, String(name)),
    copyAddress: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.copyAddress),
    openTailscale: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.openTailscale),
    openAdmin: (kind: 'dns' | 'machines'): Promise<unknown> =>
      ipcRenderer.invoke(CHANNELS.openAdmin, kind === 'machines' ? 'machines' : 'dns'),
    openDownload: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.openDownload),
    // Update-Fenster: dieselbe Regel. Keine Adresse, kein Befehl, kein Pfad kommt von der Seite.
    getUpdateView: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.getUpdateView),
    checkUpdate: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.checkUpdate),
    startUpdate: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.startUpdate),
    cancelUpdate: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.cancelUpdate),
    restartForUpdate: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.restartForUpdate),
    setUpdateAutoCheck: (enabled: boolean): Promise<unknown> =>
      ipcRenderer.invoke(CHANNELS.setUpdateAutoCheck, enabled === true),
    showUpdateLog: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.showUpdateLog),
  }),
);
