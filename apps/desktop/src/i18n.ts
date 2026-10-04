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
  connect: {
    windowTitle: 'Mit iPhone und iPad verbinden',
    title: 'Mit iPhone und iPad verbinden',
    intro:
      'iPhone und iPad erreichen Pagewise über Tailscale. Dieser Mac ist der Server: Schläft er, ist Pagewise dort nicht erreichbar.',
    addressLabel: 'Adresse im Tailnet',
    qrLabel: 'QR-Code der Adresse',
    howTo:
      'Auf dem iPhone oder iPad in Safari öffnen (Tailscale muss dort verbunden sein), dann Teilen → „Zum Home-Bildschirm“.',
    awakeOn:
      'Der Mac wird wach gehalten, solange Pagewise läuft. Bei zugeklapptem Deckel ohne externes Display schläft ein MacBook trotzdem: Lass den Deckel offen oder nutze ein externes Display und das Netzteil.',
    awakeOff:
      'Der Mac wird nicht wach gehalten (Hilfe → Mac wach halten). Schläft er, ist Pagewise auf iPhone und iPad nicht erreichbar.',
    hostLabel: 'Rechnername im Tailnet',
    hostnameLabel: 'Neutraler Rechnername',
    hostnameExplain:
      'Mit dem neuen Namen ändern sich die Adresse und damit die Herkunft der installierten iOS-App: Du meldest dich dort einmal neu an und legst die App neu auf den Home-Bildschirm.',
    states: {
      'not-installed': {
        title: 'Tailscale ist nicht installiert',
        body: 'Installiere Tailscale auf diesem Mac und auf iPhone und iPad, melde dich überall mit demselben Konto an und öffne diese Seite dann noch einmal.',
      },
      'not-logged-in': {
        title: 'Bei Tailscale nicht angemeldet',
        body: 'Öffne Tailscale und melde dich an. Danach geht es hier weiter.',
      },
      'needs-approval': {
        title: 'Dieser Mac wartet auf Freigabe',
        body: 'Ein Administrator deines Tailnets muss den Rechner in der Verwaltung freigeben.',
      },
      stopped: {
        title: 'Tailscale ist ausgeschaltet',
        body: 'Schalte Tailscale in der Menüleiste ein (oder starte die App) und prüfe dann noch einmal.',
      },
      starting: {
        title: 'Tailscale startet',
        body: 'Einen Moment, die Verbindung wird aufgebaut. Prüfe gleich noch einmal.',
      },
      'https-disabled': {
        title: 'HTTPS ist im Tailnet noch aus',
        body: 'Pagewise braucht HTTPS im Tailnet (MagicDNS und „Enable HTTPS“ in der Verwaltung unter „DNS“). Sieh dir vorher den Rechnernamen an: Mit HTTPS erscheinen die Namen deiner Geräte in einem öffentlichen Zertifikatsverzeichnis.',
      },
      running: {
        title: 'Tailscale läuft',
        body: 'Richte die Freigabe ein, damit iPhone und iPad Pagewise über HTTPS im Tailnet erreichen. Sie ist nur für dein Tailnet sichtbar, nie öffentlich.',
      },
      served: {
        title: 'Pagewise ist im Tailnet erreichbar',
        body: 'Die Freigabe zeigt auf diesen Mac. Öffne die Adresse auf iPhone oder iPad.',
      },
    },
    warnings: {
      funnel:
        'Funnel ist eingeschaltet: Der Inhalt dieses Rechners ist öffentlich im Internet erreichbar. Pagewise ist nur für dein privates Tailnet gedacht. Setze die Freigabe zurück.',
      hostname:
        'Der Rechnername „{name}“ wirkt personenbezogen. Mit HTTPS im Tailnet erscheint er im öffentlichen Zertifikatsverzeichnis (Certificate Transparency). Gib dem Mac vorher einen neutralen Namen.',
      foreign:
        'Auf Port 443 gibt es schon eine andere Freigabe. Pagewise überschreibt sie nie. Du kannst Pagewise auf Port {port} einrichten, oder die andere Freigabe selbst im Terminal ändern.',
      noPort:
        'Die Ports 443, 8443 und 10000 sind schon durch andere Freigaben belegt. Pagewise überschreibt sie nie. Ändere die Freigaben im Terminal (tailscale serve status).',
    },
    actions: {
      'setup-serve': 'Freigabe einrichten',
      'use-alt-port': 'Auf Port {port} einrichten',
      'reset-serve': 'Freigabe zurücksetzen',
      'rename-host': 'Rechnernamen ändern',
      'copy-address': 'Adresse kopieren',
      'open-tailscale': 'Tailscale öffnen',
      'open-admin-dns': 'Verwaltung öffnen (DNS)',
      'open-admin-machines': 'Verwaltung öffnen (Rechner)',
      'open-download': 'Tailscale laden',
      refresh: 'Erneut prüfen',
    },
    results: {
      ok: 'Erledigt.',
      copied: 'Adresse kopiert.',
      cancelled: 'Abgebrochen.',
      'not-running': 'Das geht erst, wenn Tailscale läuft und HTTPS im Tailnet eingeschaltet ist.',
      busy: 'Es läuft schon etwas. Einen Moment bitte.',
      'invalid-name':
        'Der Name darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten (höchstens 63 Zeichen).',
      'no-port': 'Es ist kein freier Port da.',
      foreign: 'Dort liegt eine fremde Freigabe, die Pagewise nicht überschreibt.',
      'funnel-risk': 'Aus Sicherheitsgründen abgelehnt.',
      'command-failed':
        'Tailscale hat den Befehl abgelehnt. Prüfe im Terminal „tailscale serve status“.',
      timeout:
        'Tailscale hat nicht rechtzeitig geantwortet. Prüfe, ob HTTPS im Tailnet eingeschaltet ist, und versuche es noch einmal.',
      'verify-failed':
        'Die Freigabe steht nach dem Einrichten nicht. Prüfe im Terminal „tailscale serve status“.',
    },
    confirm: {
      hostnameTitle: 'Rechnername wirkt personenbezogen',
      hostnameDetail:
        'Mit HTTPS im Tailnet wird der Name „{name}“ öffentlich in einem Zertifikatsverzeichnis sichtbar. Trotzdem einrichten? Besser: erst einen neutralen Namen vergeben.',
      hostnameAnyway: 'Trotzdem einrichten',
      renameTitle: 'Rechnernamen ändern?',
      renameDetail:
        'Der Rechner heißt danach „{name}“ im Tailnet. Dabei ändern sich die Adresse und die Herkunft der installierten iOS-App: Du meldest dich auf iPhone und iPad einmal neu an.',
      renameConfirm: 'Ändern',
      resetTitle: 'Freigabe zurücksetzen?',
      resetDetail:
        'Das entfernt alle Freigaben von „tailscale serve“ auf diesem Mac, auch solche, die nicht von Pagewise stammen. Danach kannst du Pagewise neu freigeben.',
      resetConfirm: 'Zurücksetzen',
    },
    funnelDialog: {
      title: 'Pagewise ist öffentlich im Internet erreichbar',
      detail:
        'In deiner Tailscale-Freigabe ist Funnel eingeschaltet. Pagewise ist nur für dein privates Tailnet gedacht. Setze die Freigabe zurück oder schalte Funnel selbst aus.',
      reset: 'Freigabe zurücksetzen',
      ignore: 'Nicht jetzt',
    },
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
