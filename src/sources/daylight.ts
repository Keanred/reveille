import type { DaylightSourceConfig } from '../config/schema.js';
import type { Source } from '../core/source.js';

export type DaylightState = 'normal' | 'midnight-sun' | 'polar-night';

export interface SunTimes {
  state: DaylightState;
  sunrise: number | null; // epoch ms; null in polar day/night
  sunset: number | null;
}

export interface DaylightData {
  state: DaylightState;
  sunrise: number | null;
  sunset: number | null;
  dayLengthMs: number;
  deltaVsYesterdayMs: number;
  zone: string;
}

const rad = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = rad * 23.4397;
const J0 = 0.0009;
// -0.833°: refraction at the horizon plus the sun's apparent radius.
const HORIZON = rad * -0.833;

function toDays(ms: number): number {
  return ms / DAY_MS - 0.5 + J1970 - J2000;
}

function fromJulian(j: number): number {
  return (j + 0.5 - J1970) * DAY_MS;
}

function solarMeanAnomaly(d: number): number {
  return rad * (357.5291 + 0.98560028 * d);
}

function eclipticLongitude(m: number): number {
  const center = rad * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  const perihelion = rad * 102.9372;
  return m + center + perihelion + Math.PI;
}

function declination(l: number): number {
  return Math.asin(Math.sin(OBLIQUITY) * Math.sin(l));
}

function solarTransitJ(ds: number, m: number, l: number): number {
  return J2000 + ds + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * l);
}

/**
 * Sunrise/sunset for the solar day containing `dateMs`, computed from lat/long —
 * no network. Returns null times with a polar `state` when the sun stays below
 * (polar night) or above (midnight sun) the horizon all day.
 */
export function sunTimes(lat: number, lon: number, dateMs: number): SunTimes {
  const lw = rad * -lon;
  const phi = rad * lat;
  const d = toDays(dateMs);

  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const m = solarMeanAnomaly(ds);
  const l = eclipticLongitude(m);
  const dec = declination(l);
  const noon = solarTransitJ(ds, m, l);

  const cosH =
    (Math.sin(HORIZON) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosH > 1) return { state: 'polar-night', sunrise: null, sunset: null };
  if (cosH < -1) return { state: 'midnight-sun', sunrise: null, sunset: null };

  const h = Math.acos(cosH);
  const setDs = J0 + (h + lw) / (2 * Math.PI) + n;
  const jSet = solarTransitJ(setDs, m, l);
  const jRise = noon - (jSet - noon);

  return { state: 'normal', sunrise: fromJulian(jRise), sunset: fromJulian(jSet) };
}

function dayLength(t: SunTimes): number {
  if (t.state === 'midnight-sun') return DAY_MS;
  if (t.state === 'polar-night') return 0;
  return (t.sunset as number) - (t.sunrise as number);
}

export function daylightSource(cfg: DaylightSourceConfig): Source<DaylightData> {
  const zone = cfg.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    id: cfg.id,
    kind: 'daylight',
    label: cfg.title ?? 'Daylight',
    ttl: (cfg.refresh ?? 3600) * 1000,
    timeout: 5_000,
    async fetch(ctx) {
      const now = ctx.now();
      const today = sunTimes(cfg.lat, cfg.lon, now);
      const dayLengthMs = dayLength(today);
      return {
        state: today.state,
        sunrise: today.sunrise,
        sunset: today.sunset,
        dayLengthMs,
        deltaVsYesterdayMs: dayLengthMs - dayLength(sunTimes(cfg.lat, cfg.lon, now - DAY_MS)),
        zone,
      };
    },
  };
}
