import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from './ipc';

// Preload der Hüllen-Fenster (nicht des Hauptfensters mit der Oberfläche des Servers). Nur diese Funktionen, fest
// benannt, jede mit eigenem Kanal. Nichts davon nimmt einen Kanalnamen oder Code von der Seite entgegen.
contextBridge.exposeInMainWorld(
  'pagewise',
  Object.freeze({
    getStatus: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.getStatus),
  }),
);
