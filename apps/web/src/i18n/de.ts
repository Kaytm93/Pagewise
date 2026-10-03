// Deutsche Texte der Oberfläche. Weitere Sprachen erfüllen den Typ `Messages`.
export const de = {
  app: {
    name: 'Pagewise',
  },
  common: {
    save: 'Speichern',
    cancel: 'Abbrechen',
    delete: 'Löschen',
    edit: 'Bearbeiten',
    add: 'Hinzufügen',
    back: 'Zurück',
    next: 'Weiter',
    skip: 'Überspringen',
    close: 'Schließen',
    optional: 'optional',
    retry: 'Erneut versuchen',
    showPasscode: 'Passcode anzeigen',
    hidePasscode: 'Passcode verbergen',
    openMenu: 'Menü öffnen',
    closeMenu: 'Menü schließen',
    skipToContent: 'Zum Inhalt springen',
    hoursPerWeek: '{count} Std. pro Woche',
  },
  duration: {
    lessThanMinute: 'weniger als eine Minute',
    oneMinute: 'eine Minute',
    minutes: '{count} Minuten',
  },
  errors: {
    network: 'Der Server antwortet nicht. Läuft Pagewise noch?',
    unknown: 'Das hat nicht geklappt. Bitte versuch es noch einmal.',
    nameTaken: 'Diesen Namen gibt es schon.',
    invalidName: 'Bitte gib einen Namen mit 1 bis 80 Zeichen ein, ohne Zeilenumbruch.',
    invalidText: 'Bitte gib höchstens 80 Zeichen ein, ohne Zeilenumbruch.',
  },
  connection: {
    loading: 'Verbindung wird geprüft …',
    error: 'Der Server antwortet nicht.',
    hint: 'Läuft er noch? Starte ihn mit „pnpm start“ und versuche es erneut.',
  },
  setup: {
    title: 'Willkommen bei Pagewise',
    lead: 'Pagewise gehört dir und läuft auf deinem Rechner. Lege einen Passcode fest, der den Zugang schützt.',
    codeLabel: 'Einrichtungscode',
    codeHint: 'Du findest ihn in der Konsole, in der Pagewise gestartet wurde.',
    passcodeLabel: 'Passcode',
    passcodeHint: 'Mindestens 8 Zeichen. Ein langer Satz ist besser als Sonderzeichen.',
    repeatLabel: 'Passcode wiederholen',
    submit: 'Einrichten',
    errors: {
      invalidCode: 'Der Einrichtungscode stimmt nicht.',
      tooShort: 'Der Passcode braucht mindestens 8 Zeichen.',
      tooLong: 'Der Passcode darf höchstens 128 Zeichen haben.',
      mismatch: 'Die beiden Passcodes sind verschieden.',
      alreadyConfigured: 'Pagewise ist schon eingerichtet. Lade die Seite neu und melde dich an.',
      rateLimited: 'Zu viele Versuche. Bitte warte {wait}.',
    },
  },
  login: {
    title: 'Pagewise entsperren',
    lead: 'Gib deinen Passcode ein, um weiterzumachen.',
    passcodeLabel: 'Passcode',
    submit: 'Entsperren',
    forgot:
      'Passcode vergessen? Auf dem Rechner, auf dem Pagewise läuft, setzt „pnpm --filter @pagewise/server reset-passcode“ ihn zurück. Deine Daten bleiben erhalten.',
    errors: {
      invalid: 'Der Passcode stimmt nicht.',
      rateLimited: 'Zu viele Versuche. Bitte warte {wait}.',
    },
  },
  shell: {
    navigation: 'Navigation',
    subjects: 'Fächer',
    settings: 'Einstellungen',
    notFoundTitle: 'Diese Seite gibt es nicht',
    notFoundHint: 'Der Link stimmt nicht oder das Fach wurde gelöscht.',
    toHome: 'Zur Startseite',
  },
  sidebar: {
    groups: 'Untergruppen ein- oder ausklappen',
    empty: 'Noch keine Fächer.',
  },
  home: {
    emptyTitle: 'Noch keine Fächer',
    emptyLead:
      'Lege deine Fächer an. In jedem Fach kannst du Untergruppen anlegen und später Chats und Hefteinträge führen.',
    title: 'Deine Fächer',
    groupsOne: '1 Untergruppe',
    groupsMany: '{count} Untergruppen',
  },
  subject: {
    chats: 'Chats',
    noChatsTitle: 'Noch keine Chats',
    noChatsHint: 'Hier erscheinen die Chats dieser Ansicht. Sie bleiben immer in ihrem Fach.',
  },
  settings: {
    title: 'Einstellungen',
    appearance: {
      title: 'Darstellung',
      lead: 'Hell, dunkel oder passend zu deinem Gerät.',
      system: 'Wie das Gerät',
      light: 'Hell',
      dark: 'Dunkel',
    },
    access: {
      title: 'Zugang',
      logout: 'Abmelden',
      changeTitle: 'Passcode ändern',
      current: 'Aktueller Passcode',
      next: 'Neuer Passcode',
      repeat: 'Neuen Passcode wiederholen',
      submit: 'Passcode ändern',
      success: 'Der Passcode ist geändert. Andere Geräte sind abgemeldet.',
      errors: {
        wrongCurrent: 'Der aktuelle Passcode stimmt nicht.',
        tooShort: 'Der neue Passcode braucht mindestens 8 Zeichen.',
        tooLong: 'Der neue Passcode darf höchstens 128 Zeichen haben.',
        mismatch: 'Die beiden neuen Passcodes sind verschieden.',
        rateLimited: 'Zu viele Versuche. Bitte warte {wait}.',
      },
    },
  },
} as const;

type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };
export type Messages = Widen<typeof de>;
