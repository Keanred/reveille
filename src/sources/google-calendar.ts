import type { GoogleCalendarSourceConfig } from '../config/schema.js';
import { googleTokenProvider } from '../core/google-oauth.js';
import { fetchWithTimeout, HttpError } from '../core/http.js';
import { resolveSecret } from '../core/secrets.js';
import type { Source } from '../core/source.js';
import type { TokenProvider } from '../core/token.js';
import { nextDateStr, zonedDateStr, zonedMidnight } from '../core/time.js';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars';

export interface CalendarEvent {
  id: string;
  summary: string;
  /** Absolute start instant (epoch ms). For all-day events this is midnight in `zone`. */
  startMs: number;
  allDay: boolean;
  location?: string;
}

export interface CalendarData {
  zone: string;
  /** ctx.now() at fetch time — the baseline the panel counts down from. */
  nowMs: number;
  /** Today's events, sorted by start. */
  events: CalendarEvent[];
  /** Index of the next upcoming event, or null if none remain today. */
  nextIndex: number | null;
}

/**
 * Today's events from a Google Calendar, plus which one is next. Auth is a stored
 * OAuth refresh token (via `reveille login google`) turned into access tokens by
 * {@link googleTokenProvider}; a 401 triggers one refresh-and-retry.
 *
 * "Today" and event rendering are resolved in `cfg.timezone` (default: the
 * machine's zone) so all-day events and DST behave — see `core/time.ts`.
 */
export function googleCalendarSource(cfg: GoogleCalendarSourceConfig): Source<CalendarData> {
  return {
    id: cfg.id,
    kind: 'google-calendar',
    label: cfg.title ?? 'Calendar',
    ttl: (cfg.refresh ?? 300) * 1000,
    timeout: 15_000,
    async fetch(ctx) {
      const creds = {
        clientId: await resolveSecret(cfg.clientId, ctx.secrets),
        clientSecret: await resolveSecret(cfg.clientSecret, ctx.secrets),
        refreshToken: await resolveSecret(cfg.refreshToken, ctx.secrets),
      };
      const auth = googleTokenProvider(creds, { now: ctx.now, signal: ctx.signal });

      const zone = cfg.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      const today = zonedDateStr(ctx.now(), zone);
      const timeMin = new Date(zonedMidnight(today, zone)).toISOString();
      const timeMax = new Date(zonedMidnight(nextDateStr(today), zone)).toISOString();

      const url = `${CALENDAR_API}/${encodeURIComponent(cfg.calendarId)}/events?${new URLSearchParams(
        {
          timeMin,
          timeMax,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: String(cfg.maxEvents),
        },
      )}`;

      const body = await getEvents(url, auth, ctx.signal);
      const events = (body.items ?? [])
        .map((item) => toEvent(item, zone))
        .sort((a, b) => a.startMs - b.startMs);

      const nowMs = ctx.now();
      const nextIndex = events.findIndex((e) => e.startMs > nowMs);

      return { zone, nowMs, events, nextIndex: nextIndex === -1 ? null : nextIndex };
    },
  };
}

/** A Google Calendar event resource — the subset we read. */
interface EventItem {
  id?: string;
  summary?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
}

interface EventsResponse {
  items?: EventItem[];
}

function toEvent(item: EventItem, zone: string): CalendarEvent {
  const allDay = item.start?.date != null;
  // Timed events carry an offset in dateTime, so Date.parse yields the right instant.
  // All-day events are a floating date → anchor them to midnight in `zone`.
  const startMs = allDay
    ? zonedMidnight(item.start!.date!, zone)
    : Date.parse(item.start?.dateTime ?? '');
  return {
    id: item.id ?? `${startMs}`,
    summary: item.summary ?? '(no title)',
    startMs,
    allDay,
    location: item.location,
  };
}

/** GET the events, retrying once with a fresh token if the access token 401s. */
async function getEvents(
  url: string,
  auth: TokenProvider,
  signal: AbortSignal,
): Promise<EventsResponse> {
  const call = async () =>
    fetchWithTimeout(url, { headers: { authorization: `Bearer ${await auth.token()}` }, signal });

  let res = await call();
  if (res.status === 401) {
    auth.invalidate();
    res = await call();
  }
  if (!res.ok) throw new HttpError(res.status, res.statusText, url);
  return res.json();
}
