import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

describe('loadConfig', () => {
  it('nutzt Loopback und Port 3000 als Standard', () => {
    expect(loadConfig({})).toEqual({ host: '127.0.0.1', port: 3000 });
  });

  it('liest Port und Loopback-Hosts', () => {
    expect(loadConfig({ PAGEWISE_PORT: '4100' }).port).toBe(4100);
    expect(loadConfig({ PAGEWISE_HOST: 'localhost' }).host).toBe('localhost');
    expect(loadConfig({ PAGEWISE_HOST: '::1' }).host).toBe('::1');
  });

  it('lehnt ungültige Ports ab', () => {
    expect(() => loadConfig({ PAGEWISE_PORT: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ PAGEWISE_PORT: '70000' })).toThrow(ConfigError);
    expect(() => loadConfig({ PAGEWISE_PORT: 'abc' })).toThrow(ConfigError);
  });

  it('lehnt Nicht-Loopback-Adressen ab', () => {
    expect(() => loadConfig({ PAGEWISE_HOST: '0.0.0.0' })).toThrow(/Loopback/);
    expect(() => loadConfig({ PAGEWISE_HOST: '192.168.1.20' })).toThrow(ConfigError);
  });

  it('erlaubt 0.0.0.0 nur mit ausdrücklicher Docker-Ausnahme', () => {
    const env = { PAGEWISE_HOST: '0.0.0.0', PAGEWISE_ALLOW_NON_LOOPBACK: '1' };
    expect(loadConfig(env).host).toBe('0.0.0.0');
    expect(() => loadConfig({ ...env, PAGEWISE_ALLOW_NON_LOOPBACK: 'ja' })).toThrow(ConfigError);
  });
});
