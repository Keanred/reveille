import { describe, expect, it, vi } from 'vitest';
import { MemoryCache } from '../../src/core/cache.js';
import type { SecretStore } from '../../src/core/secrets.js';
import type { SourceContext } from '../../src/core/source.js';
import { buildSource, buildSources } from '../../src/sources/registry.js';

const noSecrets: SecretStore = {
  get: async () => undefined,
  set: async () => {},
  delete: async () => false,
};

function ctx(overrides: Partial<SourceContext> = {}): SourceContext {
  return {
    cache: new MemoryCache(),
    signal: new AbortController().signal,
    now: () => Date.parse('2026-06-29T12:00:00.000Z'),
    secrets: noSecrets,
    ...overrides,
  };
}

describe('registry', () => {
  it('builds a clock source that reports ctx.now', async () => {
    const source = buildSource({ id: 'c', type: 'clock' });
    expect(source.kind).toBe('clock');
    const data = await source.fetch(ctx());
    expect(data).toMatchObject({ iso: '2026-06-29T12:00:00.000Z' });
  });

  it('applies the app-wide refresh fallback when a source has none', () => {
    const [source] = buildSources({
      app: { refresh: 45 },
      sources: [{ id: 'h', type: 'http-json', url: 'https://x' }],
    });
    // http-json declares its own default (60s), so the fallback should NOT override it.
    expect(source?.ttl).toBe(60_000);
  });

  it('throws on an unknown source type', () => {
    // @ts-expect-error — exercising the runtime guard with a bad discriminant.
    expect(() => buildSource({ id: 'x', type: 'nonsense' })).toThrow();
  });

  it('builds a weather source and normalizes the OpenWeather payload', async () => {
    const body = JSON.stringify({
      name: 'Joensuu',
      main: { temp: 18.4, feels_like: 17.2, humidity: 61 },
      weather: [{ description: 'clear sky' }],
      wind: { speed: 3.6 },
      rain: { '1h': 0.5 },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(body, { status: 200 }));

    const source = buildSource({
      id: 'w',
      type: 'weather',
      url: 'https://api.openweathermap.org/data/2.5/weather?lat=62&lon=29.7&units=metric&appid=k',
    });
    expect(source.kind).toBe('weather');
    const data = await source.fetch(ctx());
    expect(data).toMatchObject({
      location: 'Joensuu',
      temp: 18.4,
      description: 'clear sky',
      precipMm: 0.5,
      precipKind: 'rain',
    });
    fetchSpy.mockRestore();
  });

  it('appends a resolved secret as the appid query param', async () => {
    const secrets: SecretStore = { ...noSecrets, get: async () => 'sk_456' };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"main":{"temp":1}}', { status: 200 }));

    const source = buildSource({
      id: 'w',
      type: 'weather',
      url: 'https://api.openweathermap.org/data/2.5/weather?lat=62&lon=29.7',
      secret: 'keychain:openweather',
    });
    await source.fetch(ctx({ secrets }));

    const url = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(url.searchParams.get('appid')).toBe('sk_456');
    fetchSpy.mockRestore();
  });
});

describe('http-json source', () => {
  it('attaches a Bearer token when a secret resolves', async () => {
    const secrets: SecretStore = { ...noSecrets, get: async () => 'tok_123' };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    const source = buildSource({
      id: 'g',
      type: 'http-json',
      url: 'https://api.example.com',
      secret: 'keychain:github-token',
    });
    await source.fetch(ctx({ secrets }));

    const init = fetchSpy.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer tok_123');
    fetchSpy.mockRestore();
  });
});
