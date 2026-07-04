import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoogleCalendarSourceConfig } from '../../src/config/schema.js';
import { MemoryCache } from '../../src/core/cache.js';
import type { SecretStore } from '../../src/core/secrets.js';
import type { SourceContext } from '../../src/core/source.js';
import { googleCalendarSource } from '../../src/sources/google-calendar.js';

const noSecrets: SecretStore = {
  get: async () => undefined,
  set: async () => {},
  delete: async () => false,
};

// Fixed "now": 2026-07-03 12:00 UTC.
const NOW = Date.parse('2026-07-03T12:00:00Z');

function ctx(now = NOW): SourceContext {
  return {
    cache: new MemoryCache(),
    signal: new AbortController().signal,
    now: () => now,
    secrets: noSecrets,
  };
}

// Bare (unprefixed) refs resolve to literals, so no keychain is needed here.
function cfg(over: Partial<GoogleCalendarSourceConfig> = {}): GoogleCalendarSourceConfig {
  return {
    id: 'cal',
    type: 'google-calendar',
    clientId: 'cid',
    clientSecret: 'secret',
    refreshToken: 'rt',
    calendarId: 'primary',
    timezone: 'UTC',
    maxEvents: 10,
    ...over,
  } as GoogleCalendarSourceConfig;
}

const tokenOk = () =>
  new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });
const events = (items: unknown[], status = 200) =>
  new Response(JSON.stringify({ items }), { status });

const timed = (iso: string, summary: string) => ({
  id: summary,
  summary,
  start: { dateTime: iso },
});
const allDay = (date: string, summary: string) => ({ id: summary, summary, start: { date } });

/** Route by URL: the OAuth token endpoint vs the Calendar API. */
function route(calendar: (url: string) => Response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com')) return tokenOk();
    if (url.includes('/calendar/')) return calendar(url);
    throw new Error(`unexpected url ${url}`);
  });
}

afterEach(() => vi.restoreAllMocks());

describe('google-calendar source', () => {
  it('maps timed + all-day events, sorts them, and picks the next one', async () => {
    route(() =>
      events([
        timed('2026-07-03T15:00:00Z', 'later'),
        timed('2026-07-03T09:00:00Z', 'earlier'),
        allDay('2026-07-03', 'birthday'),
      ]),
    );

    const data = await googleCalendarSource(cfg()).fetch(ctx());

    expect(data.zone).toBe('UTC');
    // Sorted by start: all-day midnight, then 09:00, then 15:00.
    expect(data.events.map((e) => e.summary)).toEqual(['birthday', 'earlier', 'later']);
    expect(data.events[0]).toMatchObject({
      allDay: true,
      startMs: Date.parse('2026-07-03T00:00:00Z'),
    });
    expect(data.events[2]).toMatchObject({
      allDay: false,
      startMs: Date.parse('2026-07-03T15:00:00Z'),
    });
    // Next upcoming (start > 12:00 now) is "later".
    expect(data.nextIndex).toBe(2);
  });

  it("requests today's window with singleEvents and a Bearer token", async () => {
    const spy = route(() => events([]));
    await googleCalendarSource(cfg()).fetch(ctx());

    const call = spy.mock.calls.find(([u]) => String(u).includes('/calendar/'))!;
    const url = new URL(String(call[0]));
    expect(url.searchParams.get('timeMin')).toBe('2026-07-03T00:00:00.000Z');
    expect(url.searchParams.get('timeMax')).toBe('2026-07-04T00:00:00.000Z');
    expect(url.searchParams.get('singleEvents')).toBe('true');
    expect(url.searchParams.get('orderBy')).toBe('startTime');

    const headers = new Headers(call[1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer at');
  });

  it('retries once with a fresh token when the events call 401s', async () => {
    let calls = 0;
    route(() => {
      calls += 1;
      return calls === 1
        ? new Response('', { status: 401 })
        : events([timed('2026-07-03T15:00:00Z', 'x')]);
    });

    const data = await googleCalendarSource(cfg()).fetch(ctx());
    expect(calls).toBe(2);
    expect(data.events).toHaveLength(1);
  });

  it('reports nextIndex = null when nothing is left today', async () => {
    route(() => events([timed('2026-07-03T09:00:00Z', 'past')]));
    const data = await googleCalendarSource(cfg()).fetch(ctx());
    expect(data.nextIndex).toBeNull();
  });

  it('throws on a non-401 error so the orchestrator can fall back to cache', async () => {
    route(() => events([], 500));
    await expect(googleCalendarSource(cfg()).fetch(ctx())).rejects.toThrow();
  });
});
