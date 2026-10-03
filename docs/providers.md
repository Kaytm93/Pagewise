# Modell-Anbieter

Stand: Phase 1a (c) und (d) umgesetzt. Anbieter und Modelle lassen sich in der Oberfläche eintragen, ohne Code zu ändern, und der Chat nutzt sie.

## Provider-Registry

Gebaut ist der Typ `openai-compatible`: Name, Basis-URL, optionaler API-Key und eine Modellliste. Je Modell gibt es vier Fähigkeiten (Bilder, Werkzeuge, Denken, Streaming), die du selbst setzt, weil die Schnittstelle sie nicht zuverlässig meldet. Die Liste kannst du von Hand pflegen oder mit „Vom Anbieter laden“ aus `/models` übernehmen (höchstens 100 Modelle je Anbieter, die Auswahl bleibt bei dir).

Weitere Typen (`anthropic-messages`, `gemini`) sind nicht gebaut und kommen erst bei Bedarf. Jeder Anbieter mit OpenAI-kompatibler Schnittstelle geht schon jetzt über „Eigener Anbieter“ (zum Beispiel OpenAI, Mistral, Groq, DeepSeek).

### Voreinstellungen

Voreinstellungen sind nur Vorschläge für Adresse, Schlüsselpflicht und Modelle. Alles bleibt änderbar. Stand 3. Oktober 2026, Quellen und Werte in [decisions.md](decisions.md), D-024.

| Voreinstellung | Basis-URL | Schlüssel | Vorgeschlagene Modelle |
| --- | --- | --- | --- |
| OpenRouter | `https://openrouter.ai/api/v1` | nötig | `z-ai/glm-5.3-flash`, `openrouter/free` |
| Z.ai (API) | `https://api.z.ai/api/paas/v4` | nötig | keine, Kennungen trägst du ein |
| Ollama (lokal) | `http://localhost:11434/v1` | nicht nötig | keine, Liste vom Anbieter laden |
| LM Studio (lokal) | `http://localhost:1234/v1` | nicht nötig | keine, Liste vom Anbieter laden |
| Eigener Anbieter | leer | optional | leer |

### Regeln für Adressen

- Die Adresse muss mit `https://` beginnen. `http://` ist nur für `localhost`, `127.x.x.x` und `[::1]` erlaubt (Dienste auf diesem Rechner).
- Der Server folgt **keinen Weiterleitungen** (`redirect: 'manual'`). Sonst könnte ein Anbieter den Schlüssel an eine andere Adresse schicken lassen. Eine Weiterleitung wird als Fehler `redirected` gemeldet.
- Anbieter-Antworten sind in Größe und Menge begrenzt (JSON 8 MiB, Modellliste 2000 Einträge, Antworttext 200.000 Zeichen).

### Fehler

Der Server gibt Fehler des Anbieters nur als **Code** weiter: `unreachable`, `timeout`, `aborted`, `auth_failed`, `rate_limited`, `insufficient_credits`, `no_package`, `quota_exhausted`, `plan_expired`, `model_not_allowed`, `content_blocked`, `model_not_found`, `bad_request`, `upstream_error`, `invalid_response`, `redirected`, `models_unavailable`, `no_key`. Texte des Anbieters werden nie durchgereicht, weil sie Teile des Schlüssels oder der Eingabe wiederholen können. Die Oberfläche übersetzt die Codes in deutsche Sätze.

Der HTTP-Status allein reicht nicht immer: Z.ai antwortet bei fast allen Fehlern mit 429 und trennt sie über die Nummer im Rumpf (`{"error":{"code":"1113",…}}`). Deshalb liest der Client bei Fehlern (nur 4xx und 5xx) höchstens 4 KiB des Rumpfes und beachtet **ausschließlich** eine Nummer aus einer festen Tabelle (`BUSINESS_CODES` in `apps/server/src/providers/errors.ts`, Quelle: <https://docs.z.ai/api-reference/api-code>, Stand 3. Oktober 2026). Alles andere im Rumpf, vor allem der Text, wird nie gelesen oder weitergegeben.

| Z.ai-Nummer | Bedeutung laut Z.ai | Code in Pagewise |
| --- | --- | --- |
| 1113 | Kein Guthaben oder kein Ressourcenpaket | `no_package` |
| 1211 | Unbekanntes Modell | `model_not_found` |
| 1301 | Inhalt aus Sicherheitsgründen abgelehnt | `content_blocked` |
| 1308, 1310 | Nutzungsgrenze erreicht (mit Zeitpunkt der Rückkehr) | `quota_exhausted` |
| 1309 | Coding-Plan-Abo abgelaufen | `plan_expired` |
| 1311 | Modell gehört nicht zum Tarif | `model_not_allowed` |
| übrige 429 (z. B. 1302, 1305, 1313) | zu viele Anfragen, Überlast, Fair Use | `rate_limited` |

### Verbindung testen

- **OpenRouter:** Der Test ruft `GET /key` auf. Das prüft den Schlüssel wirklich und kostet nichts.
- **Alle anderen:** Der Test ruft `GET /models` auf. Bei einem Anbieter, dessen Modellliste ohne Schlüssel erreichbar ist, beweist das den Schlüssel **nicht**. Antwortet der Anbieter mit 404, 405 oder 501, versucht der Test eine Anfrage mit einem Token an das erste eingetragene Modell.
- Das Ergebnis ist eine Auskunft. Ein fehlgeschlagener Test verhindert das Anlegen nicht.

### Schlüssel

Der Schlüssel steht nie in der Datenbank und nie in einer Antwort. Die Oberfläche bekommt nur `hasKey` und bei Schlüsseln ab 16 Zeichen die letzten vier Zeichen. Beim Bearbeiten lässt ein leeres Feld den gespeicherten Schlüssel unverändert, „Gespeicherten Schlüssel entfernen“ löscht ihn. Details: [security.md](security.md).

## Standardmodell und Ausweichmodelle

- Das **Standardmodell** gilt, wenn weder Fach noch Chat ein anderes wählen.
- **Ausweichmodelle** (höchstens fünf) sind für den Fall gedacht, dass das gewählte Modell mit einem Fehler antwortet, bei dem ein anderes Modell oder ein späterer Versuch helfen kann (`rate_limited`, `upstream_error`, `unreachable`, `timeout`, `insufficient_credits`, `model_not_found`; im Code `ProviderError.retryable`). Ein falscher Schlüssel (`auth_failed`) oder eine fehlerhafte Anfrage (`bad_request`) löst keinen Wechsel aus. Der Server liefert die Reihenfolge (`ProviderService.chain()`), der Chat schaltet weiter, solange noch kein Text der Antwort da ist (D-027).
- Die Reihenfolge eines Versuchs ist: gewähltes Modell, dann die Ausweichmodelle, ohne Doppelte. Gewählt ist das Modell des Chats, sonst das des Fachs, sonst das Standardmodell.
- Legst du den ersten OpenRouter-Anbieter an und hast noch nichts gewählt, setzt Pagewise `z-ai/glm-5.3-flash` als Standard und als erstes Ausweichmodell. Für ein Fach oder einen Chat mit anderem Modell fängt es so Fehler ab. Gewählt wird nur, wo du noch nichts festgelegt hast.
- Entfällt ein Anbieter oder Modell, räumt der Server die Auswahl selbst auf.

Die Auswahl pro Fach steht auf der Seite des Fachs („Modell ändern“), die pro Chat oben im Chat (Knopf mit dem Modellnamen). „Keine Wahl“ lässt die übergeordnete Einstellung gelten. Ohne ein einziges gültiges Modell zeigt der Chat einen Hinweis mit Link zu den Einstellungen und sperrt das Eingabefeld.

## Kostenlose Modelle

`openrouter/free` ist ein Router über kostenlose Modelle und steht in der Vorschlagsliste, ist aber **nicht** das Standardmodell. Kostenlose Modelle (Kennung `openrouter/free` oder auf `:free` endend) sind in der Oberfläche als „kostenlos“ markiert, und das Formular zeigt den Hinweis, dass sie Eingaben protokollieren oder auswerten können. Die Dokumentation von OpenRouter unterscheidet dabei nicht ausdrücklich zwischen kostenlosen und bezahlten Modellen, jeder Anbieter dahinter hat eigene Regeln. Der Hinweis ist deshalb bewusst vorsichtig: keine persönlichen oder sensiblen Daten eingeben.

## Z.ai Coding Plan

Der Coding Plan darf laut Z.ai nicht für direkte Modell-API-Aufrufe aus eigenen Apps genutzt werden (siehe D-011). Deshalb:

- Es gibt **kein Preset**, das den Coding Plan über den Chat-Provider leitet.
- Enthält die eingetragene Basis-URL `/api/coding/`, zeigt die Oberfläche den Hinweis: „Z.ai erlaubt das Coding-Plan-Kontingent nur in unterstützten Tools; direkte API-Nutzung aus eigenen Apps kann eingeschränkt werden.“ Die Entscheidung bleibt bei dir. Der Server meldet dazu `warning: "coding_plan"`.
- Für direkte API-Chats mit GLM gilt: OpenRouter oder die allgemeine pay-per-token-API von Z.ai.
- Der Coding Plan wird nur über den Agent-CLI-Adapter genutzt, siehe [agent-cli.md](agent-cli.md).

### Wenn „der Coding Plan nicht funktioniert“ (Diagnose, 3. Oktober 2026)

Z.ai nutzt für Coding-Plan-Abos und die Pay-per-Token-API **denselben Schlüssel**. Welches Kontingent zählt, entscheidet allein die Adresse (Quelle: <https://docs.z.ai/devpack/faq>, <https://docs.z.ai/devpack/tool/others>): `https://api.z.ai/api/anthropic` für Claude Code und `https://api.z.ai/api/coding/paas/v4` für andere unterstützte Werkzeuge. Auf der allgemeinen Adresse `https://api.z.ai/api/paas/v4` (Preset „Z.ai (API)“) zählt nur Guthaben.

| Was du siehst | Wahrscheinliche Ursache | Was hilft |
| --- | --- | --- |
| „weder Guthaben noch ein passendes Paket“ (`no_package`, Z.ai 1113) | Plan-Schlüssel am Preset „Z.ai (API)“: dort zählt der Plan nicht, und auf dem Konto ist kein Guthaben | Den Plan nur über die Agent-CLI nutzen (Phase 1e). Für direkte Chats Guthaben aufladen oder OpenRouter nehmen |
| „Der Anbieter kennt dieses Modell nicht“ | Modellkennung mit Präfix wie bei OpenRouter (`z-ai/glm-5.3-flash`) | Bei Z.ai heißen die Modelle `glm-5.3-flash` und `glm-5.3` (Preset schlägt sie vor) |
| „Kontingent aufgebraucht“ (`quota_exhausted`) | Das 5-Stunden-, Wochen- oder Monatslimit des Plans ist erreicht | Warten, das Limit füllt sich wieder auf |
| „Abo abgelaufen“ (`plan_expired`) | Das Plan-Abo ist ausgelaufen | Beim Anbieter verlängern |
| „Modell gehört nicht zum Tarif“ (`model_not_allowed`) | Der Tarif enthält das gewählte Modell nicht | Modell wechseln |
| Es funktioniert technisch mit `/api/coding/paas/v4` als freiem Anbieter | Das ist ein direkter API-Aufruf aus einer eigenen App und laut Bedingungen für den Plan nicht vorgesehen (D-011) | Nicht nutzen, Agent-CLI verwenden. Die Oberfläche warnt dabei |

Einen **richtigen** Weg für den Coding Plan gibt es nur über den Agent-CLI-Adapter (Phase 1e): die unveränderte `claude`-Binary mit `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`. Die Reihenfolge der Arbeit wurde deshalb angepasst (D-036).

## Secrets

API-Keys liegen in einer Secrets-Datei mit Rechten `600` im Datenverzeichnis, nie im Repo und nie im Browser (Name `provider.<id>.key`). Die macOS-Keychain wird vorerst nicht genutzt (D-018). Die Oberfläche zeigt nur den Namen und bei langen Schlüsseln die letzten vier Zeichen und erlaubt nur das Überschreiben oder Löschen. Details: [security.md](security.md).
