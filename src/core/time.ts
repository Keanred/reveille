/**
 * Timezone-aware time helpers, kept pure and zone-explicit (no reliance on the
 * machine's `TZ`) so they can be unit-tested across DST and non-local zones.
 *
 * The trap they defend against: a "day" in a given zone is not always 24h
 * (23h/25h on DST days) and an all-day event's `date` is a floating calendar
 * date, not a UTC instant. See `test/adversarial/time.test.ts`.
 */

// ---- Timezone-dependent: fixed locale for computation, user locale for display -

/**
 * Epoch ms of 00:00:00 (local wall-clock) in `zone` on the given calendar date.
 *
 * `dateStr` is `YYYY-MM-DD`. This is the crux: there's no built-in "midnight in a
 * zone → instant", so the usual approach is to compute the zone's UTC offset for
 * that date and subtract it. One way to get the offset: format a candidate instant
 * with `Intl.DateTimeFormat(..., { timeZone: zone })`, read back the wall-clock
 * parts, and compare to the same parts interpreted as UTC.
 *
 * Must be DST-correct: `zonedMidnight('2026-03-08','America/New_York')` is 05:00Z
 * (still EST), while `zonedMidnight('2026-03-09',…)` is 04:00Z (EDT) — 23h apart.
 */
export function zonedMidnight(dateStr: string, zone: string): number {
  const utcDate = new Date(`${dateStr}T00:00:00Z`);
  // Fixed locale + hourCycle 'h23' so the parts come back as 24h Latin digits we
  // can re-parse. A user locale here would break it (12h AM/PM, or non-Latin
  // numerals) — this is computation, not display, so it must NOT be localized.
  const formatter = Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(utcDate);

  const partMap = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const zonedDate = new Date(
    `${partMap.year}-${partMap.month}-${partMap.day}T${partMap.hour}:${partMap.minute}:${partMap.second}Z`,
  );

  return utcDate.getTime() - (zonedDate.getTime() - utcDate.getTime());
}

/**
 * The `YYYY-MM-DD` calendar date that `instantMs` falls on in `zone`.
 *
 * e.g. `2026-07-03T02:00:00Z` is still July 2nd (22:00) in `America/New_York`.
 * `Intl.DateTimeFormat('en-CA', { timeZone: zone, year/month/day })` (or
 * `formatToParts`) gets you the zoned parts to assemble.
 */
export function zonedDateStr(instantMs: number, zone: string): string {
  // Assemble from parts (read by type) so we don't depend on the locale's date
  // pattern — `.format()` with en-US would give MM/DD/YYYY, not ISO.
  const parts = Object.fromEntries(
    Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date(instantMs))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Render `instantMs` as a wall-clock time in `zone`, formatted for `locale`
 * (defaults to the runtime/user locale). This is display, so the locale governs
 * 12h vs 24h and the separator — e.g. `2026-07-03T13:30:00Z` in America/New_York
 * is `09:30` (en-GB), `09:30 AM` (en-US), `09.30` (fi-FI).
 */
export function formatClock(instantMs: number, zone: string, locale?: string): string {
  const formatter = Intl.DateTimeFormat(locale, {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  });
  return formatter.format(new Date(instantMs));
}

// ---- Provided (pure date/duration math, no timezone involved) ----------------

/** The calendar day after a `YYYY-MM-DD` string. Uses UTC to avoid any zone drift. */
export function nextDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

/**
 * Human-readable countdown for a positive duration in ms: `2h 15m`, `45m`, `30s`.
 * Non-positive input means the event has started/passed → `now`.
 */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now';
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.floor(ms / 1000)}s`;
}
