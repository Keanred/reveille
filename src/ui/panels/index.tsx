import type { ReactNode } from 'react';
import type { ClockData } from '../../sources/clock.js';
import type { WeatherData } from '../../sources/weather.js';
import { ClockPanel } from './ClockPanel.js';
import { JsonPanel } from './JsonPanel.js';
import { WeatherPanel } from './WeatherPanel.js';
import { GitPanel } from './GitPanel.js';
import type { GitData } from '../../sources/git.js';

/**
 * Maps a source `kind` to its presentational body. Unknown kinds fall back to a
 * JSON dump, so a new source type renders something useful before it gets a
 * bespoke panel.
 */
export function bodyFor(kind: string): (data: unknown) => ReactNode {
  switch (kind) {
    case 'clock':
      return (data) => <ClockPanel data={data as ClockData} />;
    case 'weather':
      return (data) => <WeatherPanel data={data as WeatherData} />;
    case 'git':
      return (data) => <GitPanel data={data as GitData} />;
    default:
      return (data) => <JsonPanel data={data} />;
  }
}
