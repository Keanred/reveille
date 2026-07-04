import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatCountdown,
  nextDateStr,
  zonedDateStr,
  zonedMidnight,
} from '../../src/core/time.js';

// Every case pins an explicit IANA zone (America/New_York and UTC), so it proves
// correctness independent of the machine's TZ — the "non-local zone" the spec asks
// for. Expected instants are written as UTC so the offset math is visible.
//
// US DST in 2026: begins Sun 2026-03-08 02:00 (spring forward, 23h day),
//                  ends   Sun 2026-11-01 02:00 (fall back, 25h day).
const NY = 'America/New_York';
const HOUR = 3_600_000;

describe('zonedMidnight — STUBBED, implement me', () => {
  it('is the local midnight, expressed as a UTC instant', () => {
    // July → EDT (UTC-4): 00:00 local == 04:00Z.
    expect(zonedMidnight('2026-07-03', NY)).toBe(Date.parse('2026-07-03T04:00:00Z'));
    // UTC zone: midnight is midnight.
    expect(zonedMidnight('2026-07-03', 'UTC')).toBe(Date.parse('2026-07-03T00:00:00Z'));
  });

  it('is DST-correct: the spring-forward day is only 23h long', () => {
    const start = zonedMidnight('2026-03-08', NY); // still EST (UTC-5) → 05:00Z
    const end = zonedMidnight('2026-03-09', NY); // now EDT (UTC-4) → 04:00Z
    expect(start).toBe(Date.parse('2026-03-08T05:00:00Z'));
    expect(end).toBe(Date.parse('2026-03-09T04:00:00Z'));
    expect(end - start).toBe(23 * HOUR); // NOT 24 — this is the trap
  });

  it('is DST-correct: the fall-back day is 25h long', () => {
    const start = zonedMidnight('2026-11-01', NY); // EDT (UTC-4) → 04:00Z
    const end = zonedMidnight('2026-11-02', NY); // EST (UTC-5) → 05:00Z
    expect(end - start).toBe(25 * HOUR);
  });
});

describe('zonedDateStr — STUBBED, implement me', () => {
  it('maps an instant to its calendar date in the zone', () => {
    // 02:00Z is still the previous day (22:00) in New York.
    expect(zonedDateStr(Date.parse('2026-07-03T02:00:00Z'), NY)).toBe('2026-07-02');
    expect(zonedDateStr(Date.parse('2026-07-03T12:00:00Z'), NY)).toBe('2026-07-03');
    expect(zonedDateStr(Date.parse('2026-07-03T02:00:00Z'), 'UTC')).toBe('2026-07-03');
  });
});

describe('formatClock', () => {
  const t = Date.parse('2026-07-03T13:30:00Z'); // 09:30 in NY (EDT)

  it('renders the wall-clock time in the zone (locale pinned for determinism)', () => {
    expect(formatClock(t, NY, 'en-GB')).toBe('09:30');
    expect(formatClock(t, 'UTC', 'en-GB')).toBe('13:30');
    // Midnight must be 00:00, never 24:00.
    expect(formatClock(Date.parse('2026-07-03T04:00:00Z'), NY, 'en-GB')).toBe('00:00');
  });

  it('formats per the locale (12h vs 24h vs separator)', () => {
    expect(formatClock(t, NY, 'en-US')).toBe('09:30 AM');
    expect(formatClock(t, NY, 'fi-FI')).toBe('09.30');
  });
});

describe('nextDateStr (provided)', () => {
  it('advances one calendar day across month and year boundaries', () => {
    expect(nextDateStr('2026-03-08')).toBe('2026-03-09');
    expect(nextDateStr('2026-02-28')).toBe('2026-03-01'); // 2026 is not a leap year
    expect(nextDateStr('2026-12-31')).toBe('2027-01-01');
  });
});

describe('formatCountdown (provided)', () => {
  it('formats positive durations and clamps the past to "now"', () => {
    expect(formatCountdown(2 * HOUR + 15 * 60_000)).toBe('2h 15m');
    expect(formatCountdown(45 * 60_000)).toBe('45m');
    expect(formatCountdown(30_000)).toBe('30s');
    expect(formatCountdown(0)).toBe('now');
    expect(formatCountdown(-5000)).toBe('now');
  });
});
