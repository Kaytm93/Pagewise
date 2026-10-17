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
    checkForUpdates: 'Nach Updates suchen …',
    updateAvailable: 'Update verfügbar …',
    updateWorking: 'Update wird vorbereitet …',
    updateReady: 'Update bereit: neu starten …',
    updateFailed: 'Update gescheitert …',
  },
  tray: {
    tooltip: 'Pagewise',
    open: 'Pagewise öffnen',
    copyAddress: 'Tailscale-Adresse kopieren',
    noAddress: 'Tailscale-Adresse (noch nicht eingerichtet)',
    quit: 'Pagewise beenden',
  },
  update: {
    windowTitle: 'Nach Updates suchen',
    title: 'Pagewise aktualisieren',
    intro:
      'Pagewise holt die neueste Fassung von GitHub, baut sie auf diesem Mac, prüft sie und ersetzt dann die App. Deine Daten bleiben dabei unberührt. Es passiert nie etwas ohne deinen Klick.',
    installedLabel: 'Installiert',
    newLabel: 'Neu',
    versionUnknown: 'unbekannt',
    localChanges: 'mit lokalen Änderungen gebaut',
    changesLabel: 'Was neu ist',
    moreChanges: 'und {count} weitere',
    changesUnknown: 'Die Änderungen werden nach dem Herunterladen angezeigt.',
    stepsLabel: 'Fortschritt',
    detailsLabel: 'Ausgabe',
    autoCheck: 'Beim Start nach Updates suchen',
    autoCheckNote:
      'Dann fragt Pagewise beim Start kurz bei GitHub nach. Installiert wird auch dann nie von selbst.',
    untouched: 'Die installierte App und deine Daten sind unverändert.',
    stages: {
      idle: {
        title: 'Pagewise aktualisieren',
        body: 'Prüfe, ob es eine neuere Fassung gibt.',
      },
      checking: {
        title: 'Suche nach Updates …',
        body: 'Pagewise fragt bei GitHub nach der neuesten Fassung.',
      },
      'up-to-date': {
        title: 'Pagewise ist auf dem neuesten Stand',
        body: 'Zuletzt geprüft: {time} Uhr.',
      },
      available: {
        title: 'Ein Update ist verfügbar',
        body: 'Pagewise holt die neue Fassung, baut sie auf diesem Mac und prüft sie. Das dauert einige Minuten. Du kannst Pagewise währenddessen weiter benutzen und dieses Fenster schließen.',
      },
      working: {
        title: 'Update wird vorbereitet',
        body: 'Das dauert einige Minuten. Pagewise bleibt solange benutzbar, die laufende App wird erst am Ende ersetzt.',
      },
      ready: {
        title: 'Das Update ist bereit',
        body: 'Die neue Fassung ist gebaut und geprüft. Zum Installieren startet Pagewise neu. iPhone und iPad sind dabei kurz nicht verbunden.',
      },
      failed: {
        title: 'Das Update ist gescheitert',
        body: '',
      },
      unsupported: {
        title: 'Updates sind hier nicht möglich',
        body: '',
      },
    },
    steps: {
      fetch: 'Neue Fassung holen',
      install: 'Pakete installieren',
      build: 'App bauen',
      verify: 'App prüfen',
    },
    stepOf: 'Schritt {current} von {total}',
    actions: {
      check: 'Nach Updates suchen',
      recheck: 'Erneut prüfen',
      start: 'Jetzt aktualisieren',
      cancel: 'Abbrechen',
      restart: 'Neu starten und aktualisieren',
      'retry-check': 'Erneut versuchen',
      'retry-start': 'Erneut versuchen',
      'show-log': 'Protokoll zeigen',
    },
    results: {
      cancelled: 'Abgebrochen.',
      restarting: 'Pagewise startet neu …',
    },
    unsupported: {
      platform: 'Updates in der App gibt es nur auf dem Mac.',
      dev: 'Das ist eine Entwicklungsfassung (mit Electron aus dem Quelltext gestartet). Sie ersetzt sich nicht selbst: Hole die neue Fassung im Quelltext-Ordner mit „git pull“ und starte sie neu.',
      bundle: 'Die App liegt nicht in einem normalen App-Paket und kann sich nicht ersetzen.',
      translocated:
        'macOS hat die App in einen geschützten Bereich verschoben („App Translocation“). Ziehe Pagewise einmal in den Ordner „Programme“ oder in „~/Applications“ und öffne sie von dort.',
      'not-writable':
        'Pagewise darf den Ordner, in dem die App liegt, nicht ändern. Verschiebe die App nach „~/Applications“ (in deinen Benutzerordner) oder aktualisiere im Terminal mit „pnpm app:mac“.',
    },
    errors: {
      unsupported: 'Auf diesem System ist kein Update möglich.',
      'no-git':
        'Git wurde nicht gefunden. Installiere die Entwicklerwerkzeuge von Apple (im Terminal „xcode-select --install“) und versuche es noch einmal.',
      'no-tools':
        'Node.js oder pnpm wurden nicht gefunden. Baue Pagewise einmal im Terminal mit „pnpm app:mac“ neu: Danach merkt sich die App die Werkzeuge.',
      network:
        'GitHub ist gerade nicht erreichbar. Prüfe die Internetverbindung und versuche es noch einmal.',
      'git-failed': 'Git konnte die neue Fassung nicht holen. Die Ausgabe zeigt, woran es lag.',
      'install-failed':
        'Die Pakete ließen sich nicht installieren. Die Ausgabe zeigt, woran es lag.',
      'build-failed': 'Das Bauen der App ist gescheitert. Die Ausgabe zeigt, woran es lag.',
      'verify-failed': 'Die gebaute App hat die Prüfung nicht bestanden.',
      'smoke-failed': 'Die neue App startet nicht richtig (Rauchtest fehlgeschlagen).',
      'disk-space': 'Es ist zu wenig Speicherplatz frei: Das Bauen braucht rund 2 GB.',
      cancelled: 'Abgebrochen.',
      'not-ready':
        'Die vorbereitete Fassung gibt es nicht mehr. Bereite das Update noch einmal vor.',
      'handoff-failed': 'Der Austausch ließ sich nicht starten.',
    },
    restartDialog: {
      title: 'Pagewise jetzt neu starten?',
      detail:
        'Pagewise beendet sich, setzt die neue Fassung ein und startet von selbst wieder. Das dauert etwa eine halbe Minute. In dieser Zeit erreichen iPhone und iPad Pagewise nicht.',
      confirm: 'Neu starten und aktualisieren',
    },
    done: {
      title: 'Pagewise wurde aktualisiert',
      failedTitle: 'Das Update ließ sich nicht einsetzen',
      failedDetail: 'Die bisherige App läuft weiter. Grund: {reason}',
    },
    availableNotice: {
      title: 'Update für Pagewise verfügbar',
      body: 'Klicke hier, um es zu installieren.',
    },
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
  startingPage: {
    title: 'Pagewise',
    starting: {
      title: 'Pagewise startet',
      message: 'Der Server startet. Einen Moment bitte …',
    },
    restarting: {
      title: 'Pagewise startet neu',
      message: 'Der Server startet gerade neu. Einen Moment bitte …',
    },
    stopped: {
      title: 'Pagewise ist ausgeschaltet',
      message:
        'Der Server ist gestoppt. Zum erneuten Starten „Server neu starten“ im Menü „Pagewise“ oder im Menüleisten-Symbol wählen.',
    },
    failed: {
      title: 'Pagewise läuft nicht',
      fallback: 'Der Server konnte nicht gestartet werden.',
    },
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
