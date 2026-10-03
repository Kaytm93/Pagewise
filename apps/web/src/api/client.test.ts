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
});
