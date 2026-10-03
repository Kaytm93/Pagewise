import { codeForStatus, ProviderError } from './errors';
import { readSse } from './sse';

/** Ziel einer Anfrage. Der Schlüssel kommt aus dem Secret-Speicher und wird nur hier verwendet. */
export interface Target {
  baseUrl: string;
  apiKey: string | null;
}

export interface UpstreamModel {
  id: string;
  name: string | null;
  /** `null`, wenn der Anbieter dazu nichts angibt. */
  vision: boolean | null;
  tools: boolean | null;
  reasoning: boolean | null;
  free: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'usage'; promptTokens: number | null; completionTokens: number | null }
  | { type: 'finish'; reason: string | null };

export type TestResult =
  | { ok: true; latencyMs: number; modelCount: number | null }
  | { ok: false; code: ProviderError['code'] };

export interface ClientOptions {
  fetch?: typeof fetch;
  /** Zeitlimit für einfache Anfragen (Modellliste, Test). */
  requestTimeoutMs?: number;
  /** Höchstzeit ohne neue Daten im Antwortstrom. */
  idleTimeoutMs?: number;
}

const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_LISTED_MODELS = 2000;
const MAX_REPLY_CHARACTERS = 200_000;

type Json = unknown;

function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: Json): string | null {
  return typeof value === 'string' ? value : null;
}

function int(value: Json): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

/** Preis aus der Modellliste (Zeichenkette oder Zahl) oder `NaN`, wenn keiner angegeben ist. */
function price(value: Json): number {
  return typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN;
}

/**
 * Spricht OpenAI-kompatible Schnittstellen an (`/models`, `/chat/completions`). Sicherheitsregeln:
 * Weiterleitungen werden nie verfolgt (sonst ginge der Schlüssel an einen anderen Host), Fehler
 * bestehen nur aus Codes, und der Schlüssel taucht in keiner Meldung auf.
 */
export class ProviderClient {
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly idleTimeoutMs: number;

  constructor(options: ClientOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 120_000;
  }

  private headers(target: Target, extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json', ...extra };
    if (target.apiKey) headers.Authorization = `Bearer ${target.apiKey}`;
    return headers;
  }

  /** Eine Anfrage senden. Fehler beim Verbinden und Antworten außerhalb von 2xx werden zu `ProviderError`. */
  private async send(
    target: Target,
    path: string,
    init: {
      method: 'GET' | 'POST';
      body?: unknown;
      signal?: AbortSignal;
      /** Höchstdauer der ganzen Anfrage; `null` für Ströme, die nur der Leerlauf-Wächter begrenzt. */
      timeoutMs?: number | null;
    },
    watchdog?: AbortController,
  ): Promise<Response> {
    const timeoutMs = init.timeoutMs === undefined ? this.requestTimeoutMs : init.timeoutMs;
    const timeout = timeoutMs === null ? null : AbortSignal.timeout(timeoutMs);
    const signals = [timeout, init.signal, watchdog?.signal].filter(
      (signal): signal is AbortSignal => signal !== undefined && signal !== null,
    );
    const signal = AbortSignal.any(signals);
    let response: Response;
    try {
      response = await this.fetchImpl(`${target.baseUrl}${path}`, {
        method: init.method,
        headers: this.headers(
          target,
          init.body === undefined ? {} : { 'Content-Type': 'application/json' },
        ),
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        redirect: 'manual',
        signal,
      });
    } catch {
      throw this.abortError(init.signal, timeout, watchdog) ?? new ProviderError('unreachable');
    }
    if (!response.ok) {
      // Den Rumpf nicht lesen: er kann den Schlüssel oder die Eingabe wiederholen.
      await response.body?.cancel().catch(() => {});
      throw new ProviderError(codeForStatus(response.status), response.status);
    }
    return response;
  }

  private abortError(
    caller: AbortSignal | undefined,
    timeout: AbortSignal | null,
    watchdog: AbortController | undefined,
  ): ProviderError | null {
    if (caller?.aborted) return new ProviderError('aborted');
    if (timeout?.aborted || watchdog?.signal.aborted) return new ProviderError('timeout');
    return null;
  }

  private async readJson(response: Response): Promise<Json> {
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError('invalid_response');
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_JSON_BYTES) throw new ProviderError('invalid_response');
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return JSON.parse(text);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('invalid_response');
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  /** Modellliste des Anbieters (`GET /models`). */
  async listModels(target: Target, signal?: AbortSignal): Promise<UpstreamModel[]> {
    const response = await this.send(target, '/models', { method: 'GET', signal });
    const json = await this.readJson(response);
    const list = isRecord(json) ? json.data : null;
    if (!Array.isArray(list)) throw new ProviderError('invalid_response');

    const models: UpstreamModel[] = [];
    for (const entry of list) {
      if (!isRecord(entry)) continue;
      const id = str(entry.id)?.trim();
      if (!id || id.length > 200) continue;
      const architecture = isRecord(entry.architecture) ? entry.architecture : null;
      const modalities = Array.isArray(architecture?.input_modalities)
        ? architecture.input_modalities
        : null;
      const parameters = Array.isArray(entry.supported_parameters)
        ? entry.supported_parameters
        : null;
      const pricing = isRecord(entry.pricing) ? entry.pricing : null;
      models.push({
        id,
        name: str(entry.name)?.slice(0, 200) ?? null,
        vision: modalities ? modalities.includes('image') : null,
        tools: parameters ? parameters.includes('tools') : null,
        reasoning: parameters ? parameters.includes('reasoning') : null,
        free: pricing !== null && price(pricing.prompt) === 0 && price(pricing.completion) === 0,
      });
      if (models.length >= MAX_LISTED_MODELS) break;
    }
    return models;
  }

  /**
   * Prüft Erreichbarkeit und Schlüssel. OpenRouter hat dafür einen eigenen Endpunkt (`/key`), die
   * Modellliste ist dort öffentlich. Sonst dient `/models`, und nur wenn es sie nicht gibt, eine
   * Mini-Anfrage an ein bekanntes Modell.
   */
  async test(
    target: Target,
    options: { preset: string; probeModel: string | null; signal?: AbortSignal },
  ): Promise<TestResult> {
    const started = Date.now();
    try {
      if (options.preset === 'openrouter') {
        if (!target.apiKey) return { ok: false, code: 'no_key' };
        const response = await this.send(target, '/key', {
          method: 'GET',
          signal: options.signal,
        });
        await this.readJson(response);
        return { ok: true, latencyMs: Date.now() - started, modelCount: null };
      }

      try {
        const models = await this.listModels(target, options.signal);
        return { ok: true, latencyMs: Date.now() - started, modelCount: models.length };
      } catch (error) {
        const unsupported =
          error instanceof ProviderError &&
          (error.status === 404 || error.status === 405 || error.status === 501);
        if (!unsupported) throw error;
      }

      if (!options.probeModel) return { ok: false, code: 'models_unavailable' };
      const response = await this.send(target, '/chat/completions', {
        method: 'POST',
        body: {
          model: options.probeModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        },
        signal: options.signal,
      });
      await this.readJson(response);
      return { ok: true, latencyMs: Date.now() - started, modelCount: null };
    } catch (error) {
      if (error instanceof ProviderError) return { ok: false, code: error.code };
      throw error;
    }
  }

  /**
   * Antwort eines Modells als Strom von Ereignissen. Wirft `ProviderError`, auch mitten im Strom.
   * Liefert der Server trotz `stream: true` eine gewöhnliche JSON-Antwort, wird sie wie ein Strom behandelt.
   */
  async *streamChat(
    target: Target,
    request: ChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    const watchdog = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => watchdog.abort(), this.idleTimeoutMs);
    };

    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream: true,
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;

    try {
      arm();
      const response = await this.send(
        target,
        '/chat/completions',
        { method: 'POST', body, signal, timeoutMs: null },
        watchdog,
      );
      arm();

      const type = response.headers.get('content-type') ?? '';
      if (!response.body) throw new ProviderError('invalid_response');
      if (type.includes('application/json')) {
        yield* this.wholeReply(await this.readJson(response));
        return;
      }

      let finished = false;
      let characters = 0;
      try {
        for await (const sse of readSse(response.body, arm)) {
          if (sse.data === '[DONE]') break;
          for (const event of this.parseChunk(sse.data)) {
            if (event.type === 'delta' || event.type === 'reasoning') {
              characters += event.text.length;
              if (characters > MAX_REPLY_CHARACTERS) throw new ProviderError('invalid_response');
            }
            if (event.type === 'finish') finished = true;
            yield event;
          }
        }
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw this.abortError(signal, null, watchdog) ?? new ProviderError('unreachable');
      }
      if (!finished) yield { type: 'finish', reason: null };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Ein Datenblock des Stroms. Fehler mitten im Strom sind Teil des Blocks (`error`). */
  private parseChunk(data: string): ChatEvent[] {
    let json: Json;
    try {
      json = JSON.parse(data);
    } catch {
      throw new ProviderError('invalid_response');
    }
    if (!isRecord(json)) throw new ProviderError('invalid_response');
    if (json.error !== undefined && json.error !== null) throw new ProviderError('upstream_error');

    const events: ChatEvent[] = [];
    const choice =
      Array.isArray(json.choices) && isRecord(json.choices[0]) ? json.choices[0] : null;
    if (choice) {
      if (choice.error !== undefined && choice.error !== null) {
        throw new ProviderError('upstream_error');
      }
      const delta = isRecord(choice.delta) ? choice.delta : null;
      const reasoning = str(delta?.reasoning_content) ?? str(delta?.reasoning);
      if (reasoning) events.push({ type: 'reasoning', text: reasoning });
      const content = str(delta?.content);
      if (content) events.push({ type: 'delta', text: content });
    }
    if (isRecord(json.usage)) {
      events.push({
        type: 'usage',
        promptTokens: int(json.usage.prompt_tokens),
        completionTokens: int(json.usage.completion_tokens),
      });
    }
    // Das Ende steht oft im selben Block wie der letzte Text; es kommt deshalb zuletzt.
    const reason = choice ? str(choice.finish_reason) : null;
    if (reason) events.push({ type: 'finish', reason });
    return events;
  }

  private *wholeReply(json: Json): Generator<ChatEvent> {
    if (!isRecord(json) || (json.error !== undefined && json.error !== null)) {
      throw new ProviderError(isRecord(json) ? 'upstream_error' : 'invalid_response');
    }
    const choice =
      Array.isArray(json.choices) && isRecord(json.choices[0]) ? json.choices[0] : null;
    const message = choice && isRecord(choice.message) ? choice.message : null;
    const content = str(message?.content);
    if (content === null) throw new ProviderError('invalid_response');
    if (content.length > MAX_REPLY_CHARACTERS) throw new ProviderError('invalid_response');
    if (content) yield { type: 'delta', text: content };
    if (isRecord(json.usage)) {
      yield {
        type: 'usage',
        promptTokens: int(json.usage.prompt_tokens),
        completionTokens: int(json.usage.completion_tokens),
      };
    }
    yield { type: 'finish', reason: str(choice?.finish_reason) };
  }
}
