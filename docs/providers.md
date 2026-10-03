# Modell-Anbieter

Stand: Entwurf für Phase 1a. Noch nicht umgesetzt.

## Provider-Registry

Anbieter werden in der Oberfläche hinzugefügt, ohne Code-Änderung.

| Typ | Beschreibung |
| --- | --- |
| `openai-compatible` | Name, Basis-URL, API-Key, Modellliste (automatisch über `/models` oder manuell), Fähigkeiten (Vision, Tools, Streaming, Reasoning) |
| `anthropic-messages` | Anthropic-Messages-Schnittstelle |
| `gemini` | bei Bedarf |

Presets sind nur Voreinstellungen und alles bleibt überschreibbar: OpenRouter, OpenAI, Anthropic, Google, DeepSeek, Mistral, Groq, Together, Fireworks, Z.ai (allgemeine API `https://api.z.ai/api/paas/v4`) sowie lokale Server (Ollama, LM Studio).

Pro Fach und pro Chat wählst du (Anbieter, Modell). Dazu kommen eine Fallback-Kette und ein Knopf „Verbindung testen“.

## Standard

- OpenRouter mit `z-ai/glm-5.3-flash` (multimodal, Bilder und Tools, siehe [decisions.md](decisions.md), D-012)
- OpenRouter Free-Router `openrouter/free`, mit Fallback auf `z-ai/glm-5.3-flash` bei Fehlern oder Rate-Limits

Free-Modelle können Prompts protokollieren. Die Oberfläche weist darauf hin: keine sensiblen Daten eingeben.

## Z.ai Coding Plan

Der Coding Plan darf laut Z.ai nicht für direkte Modell-API-Aufrufe aus eigenen Apps genutzt werden (siehe D-011). Deshalb:

- Es gibt **kein Preset**, das den Coding Plan über den Chat-Provider leitet.
- Enthält die eingetragene Basis-URL `/api/coding/`, zeigt die Oberfläche den Hinweis: „Z.ai erlaubt das Coding-Plan-Kontingent nur in unterstützten Tools; direkte API-Nutzung aus eigenen Apps kann eingeschränkt werden.“ Die Entscheidung bleibt bei dir.
- Für direkte API-Chats mit GLM gilt: OpenRouter oder die allgemeine pay-per-token-API von Z.ai.
- Der Coding Plan wird nur über den Agent-CLI-Adapter genutzt, siehe [agent-cli.md](agent-cli.md).

## Secrets

API-Keys liegen in einer Secrets-Datei mit Rechten `600` im Datenverzeichnis, nie im Repo und nie im Browser. Die macOS-Keychain wird vorerst nicht genutzt (D-018). Die Oberfläche zeigt nur den Namen und bei langen Schlüsseln die letzten vier Zeichen und erlaubt nur das Überschreiben oder Löschen. Details: [security.md](security.md).
