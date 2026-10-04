// Deutsche Texte der Mac-App (Menü, Menüleisten-Symbol, Dialoge). Wie in der Oberfläche gehören Texte hierher
// und nicht in die Logik.
export const de = {
  app: { name: 'Pagewise' },
  menu: {
    about: 'Über Pagewise',
    settings: 'Einstellungen …',
    services: 'Dienste',
    hide: 'Pagewise ausblenden',
    hideOthers: 'Andere ausblenden',
    showAll: 'Alle einblenden',
    quit: 'Pagewise beenden',
    file: 'Ablage',
    newChat: 'Neuer Chat',
    closeWindow: 'Fenster schließen',
    print: 'Drucken …',
    edit: 'Bearbeiten',
    undo: 'Widerrufen',
    redo: 'Wiederholen',
    cut: 'Ausschneiden',
    copy: 'Kopieren',
    paste: 'Einsetzen',
    selectAll: 'Alles auswählen',
    view: 'Darstellung',
    reload: 'Neu laden',
    zoomIn: 'Größer',
    zoomOut: 'Kleiner',
    resetZoom: 'Tatsächliche Größe',
    fullscreen: 'Vollbild',
    window: 'Fenster',
    minimize: 'Im Dock ablegen',
    zoom: 'Zoomen',
    front: 'Alle nach vorne bringen',
    help: 'Hilfe',
    connect: 'Mit iPhone und iPad verbinden …',
    setupCode: 'Einrichtungscode anzeigen …',
    keepAwake: 'Mac wach halten',
    openAtLogin: 'Bei Anmeldung starten',
    resetPasscode: 'Passcode zurücksetzen …',
    docs: 'Anleitung öffnen',
    restartServer: 'Server neu starten',
  },
  tray: {
    tooltip: 'Pagewise',
    open: 'Pagewise öffnen',
    copyAddress: 'Tailscale-Adresse kopieren',
    noAddress: 'Tailscale-Adresse (noch nicht eingerichtet)',
    quit: 'Pagewise beenden',
  },
  server: {
    stopped: 'Server gestoppt',
    starting: 'Server startet …',
    running: 'Server läuft (Port {port})',
    restarting: 'Server startet neu …',
    failed: 'Server läuft nicht',
  },
  failures: {
    crashLoop:
      'Der Server ist mehrmals hintereinander abgestürzt und wird nicht weiter neu gestartet. Wähle „Server neu starten“, wenn du es noch einmal versuchen willst.',
    startTimeout: 'Der Server hat sich nach 20 Sekunden nicht gemeldet.',
    unexpected: 'Der Server konnte nicht gestartet werden.',
  },
  dialogs: {
    startFailedTitle: 'Pagewise startet nicht',
    ok: 'OK',
    cancel: 'Abbrechen',
    quitTitle: 'Pagewise beenden?',
    quitDetailBase:
      'Solange Pagewise beendet ist, erreichen iPhone und iPad es nicht. Zum Weiterlaufen im Hintergrund schließe nur das Fenster (Cmd+W).',
    quitRunningOne: 'Eine Antwort läuft noch und wird unterbrochen.',
    quitRunningMany: '{count} Antworten laufen noch und werden unterbrochen.',
    quitSessions: 'Angemeldet: {count}.',
    quitConfirm: 'Beenden',
    setupCodeTitle: 'Einrichtungscode',
    setupCodeBody:
      'Gib diesen Code im Fenster ein, um Pagewise einzurichten und deinen Passcode festzulegen.',
    setupCodeNone:
      'Pagewise ist schon eingerichtet. Ein neuer Code erscheint nur nach „Passcode zurücksetzen“.',
    copy: 'Kopieren',
    resetTitle: 'Passcode zurücksetzen?',
    resetDetail:
      'Der Passcode und alle Anmeldungen werden entfernt, auch auf iPhone und iPad. Fächer, Chats und Hefteinträge bleiben erhalten. Danach legst du mit einem neuen Einrichtungscode einen neuen Passcode fest.',
    resetConfirm: 'Zurücksetzen',
    resetFailed: 'Der Passcode konnte nicht zurückgesetzt werden.',
    downloadDone: 'Download fertig',
    showInFinder: 'Im Finder zeigen',
    loginApprovalTitle: 'Freigabe nötig',
    loginApprovalDetail:
      'macOS verlangt, dass du Pagewise in den Systemeinstellungen unter „Allgemein → Anmeldeobjekte“ erlaubst, damit es bei der Anmeldung startet.',
    openSystemSettings: 'Systemeinstellungen öffnen',
  },
} as const;

export type Messages = typeof de;
export const messages: Messages = de;

/** Setzt `{name}`-Platzhalter ein. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
