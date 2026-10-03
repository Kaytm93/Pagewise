import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './client';

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
  });
}

function setup(reply: () => Response | Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(async () => reply());
  const onSessionLost = vi.fn();
  const client = new ApiClient({ fetch: fetchMock, onSessionLost });
  return { client, fetchMock, onSessionLost };
}

function lastInit(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): RequestInit {
  return fetchMock.mock.calls.at(-1)?.[1] ?? {};
}

describe('ApiClient', () => {
  it('schickt JSON und liest die Antwort', async () => {
    const { client, fetchMock } = setup(() => jsonResponse(200, { hallo: 'welt' }));
    const result = await client.request<{ hallo: string }>('POST', '/api/test', { a: 1 });
    expect(result).toEqual({ hallo: 'welt' });
    const init = lastInit(fetchMock);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('schickt bei GET keinen Körper und keinen Content-Type', async () => {
    const { client, fetchMock } = setup(() => jsonResponse(200, {}));
    await client.request('GET', '/api/test');
    expect(lastInit(fetchMock).body).toBeUndefined();
    expect(lastInit(fetchMock).headers).not.toHaveProperty('Content-Type');
  });

  it('schickt das CSRF-Token erst, wenn eines gesetzt ist, und nicht mehr nach dem Löschen', async () => {
    const { client, fetchMock } = setup(() => jsonResponse(200, {}));
    await client.request('POST', '/api/test');
    expect(lastInit(fetchMock).headers).not.toHaveProperty('X-CSRF-Token');

    client.setCsrfToken('token-eins');
    await client.request('POST', '/api/test');
    expect(lastInit(fetchMock).headers).toMatchObject({ 'X-CSRF-Token': 'token-eins' });

    client.setCsrfToken(null);
    await client.request('POST', '/api/test');
    expect(lastInit(fetchMock).headers).not.toHaveProperty('X-CSRF-Token');
  });

  it('gibt bei 204 nichts zurück', async () => {
    const { client } = setup(() => jsonResponse(204));
    await expect(client.request('DELETE', '/api/test')).resolves.toBeUndefined();
  });

  it('macht aus Fehlerantworten einen ApiError mit Code und Zusätzen', async () => {
    const { client } = setup(() =>
      jsonResponse(429, { error: 'rate_limited', retryAfterSeconds: 120 }),
    );
    const error = await client.request('POST', '/api/test').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'rate_limited', status: 429 });
    expect((error as ApiError).details.retryAfterSeconds).toBe(120);
  });

  it('übernimmt Feld und Grund bei ungültigen Eingaben', async () => {
    const { client } = setup(() =>
      jsonResponse(400, { error: 'invalid_input', field: 'passcode', reason: 'too_short' }),
    );
    const error = (await client.request('POST', '/api/test').catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('invalid_input');
    expect(error.details).toEqual({ field: 'passcode', reason: 'too_short' });
  });

  it('nutzt „unknown“, wenn die Fehlerantwort kein JSON ist', async () => {
    const { client } = setup(() => new Response('<html>Bad Gateway</html>', { status: 502 }));
    const error = (await client.request('GET', '/api/test').catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({ code: 'unknown', status: 502 });
    expect(error.message).toBe('unknown');
  });

  it('meldet einen nicht erreichbaren Server als „network“', async () => {
    const { client } = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    const error = (await client.request('GET', '/api/test').catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({ code: 'network', status: 0 });
  });

  it('reicht einen Abbruch unverändert durch', async () => {
    const { client } = setup(() => {
      throw new DOMException('abgebrochen', 'AbortError');
    });
    await expect(client.request('GET', '/api/test')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each([
    ['unauthorized', 401],
    ['csrf', 403],
  ])('meldet den Verlust der Sitzung bei Code %s', async (code, status) => {
    const { client, onSessionLost } = setup(() => jsonResponse(status, { error: code }));
    await client.request('GET', '/api/test').catch(() => undefined);
    expect(onSessionLost).toHaveBeenCalledTimes(1);
  });

  it('meldet keinen Verlust der Sitzung bei einem falschen Passcode, auch nicht bei Status 401', async () => {
    const { client, onSessionLost } = setup(() => jsonResponse(401, { error: 'invalid_passcode' }));
    await client.request('POST', '/api/auth/login', {}).catch(() => undefined);
    expect(onSessionLost).not.toHaveBeenCalled();
  });

  describe('stream', () => {
    function eventStream(chunks: string[], fail = false): Response {
      const encoder = new TextEncoder();
      let index = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks[index];
          index += 1;
          if (chunk !== undefined) controller.enqueue(encoder.encode(chunk));
          else if (fail) controller.error(new TypeError('network error'));
          else controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }

    it('liefert die Nachrichten und meldet das Ende', async () => {
      const { client, fetchMock } = setup(() =>
        eventStream(['event: delta\ndata: {"te', 'xt":"a"}\n\nevent: ping\ndata: {}\n\n']),
      );
      client.setCsrfToken('token-eins');
      const seen: string[] = [];
      const result = await client.stream('POST', '/api/test', { a: 1 }, (m) =>
        seen.push(`${m.event}:${m.data}`),
      );
      expect(result).toBe('streamed');
      expect(seen).toEqual(['delta:{"text":"a"}', 'ping:{}']);
      expect(lastInit(fetchMock).headers).toMatchObject({
        Accept: 'text/event-stream',
        'X-CSRF-Token': 'token-eins',
      });
    });

    it('meldet „empty“ bei 204', async () => {
      const { client } = setup(() => jsonResponse(204));
      expect(await client.stream('GET', '/api/test', undefined, () => {})).toBe('empty');
    });

    it('wirft einen ApiError mit dem Code des Servers', async () => {
      const { client } = setup(() => jsonResponse(409, { error: 'busy' }));
      await expect(client.stream('POST', '/api/test', {}, () => {})).rejects.toMatchObject({
        code: 'busy',
        status: 409,
      });
    });

    it('meldet einen abgerissenen Strom als network', async () => {
      const { client } = setup(() => eventStream(['event: a\ndata: 1\n\n'], true));
      const seen: string[] = [];
      await expect(
        client.stream('GET', '/api/test', undefined, (m) => seen.push(m.event)),
      ).rejects.toMatchObject({ code: 'network' });
      expect(seen).toEqual(['a']);
    });

    it('meldet einen nicht erreichbaren Server als network', async () => {
      const client = new ApiClient({
        fetch: async () => {
          throw new TypeError('Failed to fetch');
        },
      });
      await expect(client.stream('GET', '/api/test', undefined, () => {})).rejects.toMatchObject({
        code: 'network',
      });
    });

    it('lässt einen gewollten Abbruch als AbortError durch', async () => {
      const controller = new AbortController();
      const { client } = setup(() => {
        const body = new ReadableStream<Uint8Array>({
          start(stream) {
            controller.signal.addEventListener('abort', () =>
              stream.error(new DOMException('aborted', 'AbortError')),
            );
          },
        });
        return new Response(body, { status: 200 });
      });
      const pending = client.stream('GET', '/api/test', undefined, () => {}, controller.signal);
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('sendet bei einer verlorenen Sitzung das Signal an onSessionLost', async () => {
      const { client, onSessionLost } = setup(() => jsonResponse(401, { error: 'unauthorized' }));
      await expect(client.stream('GET', '/api/test', undefined, () => {})).rejects.toBeInstanceOf(
        ApiError,
      );
      expect(onSessionLost).toHaveBeenCalledTimes(1);
    });
  });
});
