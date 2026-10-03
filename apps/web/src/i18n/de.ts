// Deutsche Texte der Oberfläche. Weitere Sprachen erfüllen den Typ `Messages`.
export const de = {
  app: {
    name: 'Schulheft',
  },
  sidebar: {
    subjects: 'Fächer',
    emptyTitle: 'Noch keine Fächer',
    emptyHint: 'Sobald das Onboarding steht, legst du hier deine Fächer an.',
  },
  main: {
    title: 'Dein Schulheft startet leer',
    lead: 'Fächer, Prompts und Modelle richtest du selbst ein. Deine Daten bleiben auf deinem Rechner.',
  },
  health: {
    heading: 'Verbindung zum Server',
    loading: 'Verbindung wird geprüft …',
    ok: 'Server erreichbar, Version {version}.',
    error: 'Der Server antwortet nicht.',
    errorHint: 'Läuft er noch? Starte ihn mit „pnpm start“ und versuche es erneut.',
    retry: 'Erneut prüfen',
  },
} as const;

type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };
export type Messages = Widen<typeof de>;
