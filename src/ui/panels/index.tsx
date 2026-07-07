import type { ReactNode } from 'react';
import type { ClockData } from '../../sources/clock.js';
import type { WeatherData } from '../../sources/weather.js';
import { ClockPanel } from './ClockPanel.js';
import { JsonPanel } from './JsonPanel.js';
import { WeatherPanel } from './WeatherPanel.js';
import { GitPanel } from './GitPanel.js';
import type { GitData } from '../../sources/git.js';
import { GithubPanel } from './GithubPanel.js';
import type { GithubData } from '../../sources/github.js';
import { GoogleCalendarPanel } from './GoogleCalendarPanel.js';
import type { CalendarData } from '../../sources/google-calendar.js';
import { TodoPanel } from './TodoPanel.js';
import type { TodoData } from '../../sources/todo.js';
import { LocalsPanel } from './LocalsPanel.js';
import type { LocalsData } from '../../sources/locals.js';
import type { DaylightData } from '../../sources/daylight.js';
import { DaylightPanel } from './DaylightPanel.js';
import type { HeadlineData } from '../../sources/headline.js';
import { HeadlinePanel } from './HeadlinePanel.js';
import { DockerPanel } from './DockerPanel.js';
import type { DockerData } from '../../sources/docker.js';

export function bodyFor(kind: string): (data: unknown) => ReactNode {
  switch (kind) {
    case 'clock':
      return (data) => <ClockPanel data={data as ClockData} />;
    case 'weather':
      return (data) => <WeatherPanel data={data as WeatherData} />;
    case 'git':
      return (data) => <GitPanel data={data as GitData} />;
    case 'github':
      return (data) => <GithubPanel data={data as GithubData} />;
    case 'google-calendar':
      return (data) => <GoogleCalendarPanel data={data as CalendarData} />;
    case 'todo':
      return (data) => <TodoPanel data={data as TodoData} />;
    case 'locals':
      return (data) => <LocalsPanel data={data as LocalsData} />;
    case 'daylight':
      return (data) => <DaylightPanel data={data as DaylightData} />;
    case 'headline':
      return (data) => <HeadlinePanel data={data as HeadlineData} />;
    case 'docker':
      return (data) => <DockerPanel data={data as DockerData} />;
    default:
      return (data) => <JsonPanel data={data} />;
  }
}
