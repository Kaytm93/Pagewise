/** Ein Treffer der Websuche, nach Länge und Form begrenzt. Der Text ist Material, keine Anweisung. */
export interface WebResult {
  title: string;
  /** Immer `http` oder `https`. Andere Adressen gehen nie an das Modell. */
  url: string;
  description: string;
}

/** Die Websuche, so wie das Werkzeug `web_search` sie braucht. */
export interface WebSearch {
  /** Ob Suchen jetzt möglich sind: eingeschaltet und mit gespeichertem Schlüssel. */
  available(): Promise<boolean>;
  /** Sucht im Web. Fehler kommen als `ToolError` mit kurzem Code. */
  search(query: string, count: number, signal?: AbortSignal): Promise<WebResult[]>;
}
