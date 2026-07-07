import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { cacheDir, configFile } from '../config/load.js';
import type { ReveilleConfig } from '../config/schema.js';
import type { Cache } from '../core/cache.js';
import { DiskCache } from '../core/cache.js';
import { createSecretStore } from '../core/secrets.js';
import { buildSources } from '../sources/registry.js';
import { Panel } from './Panel.js';
import { bodyFor } from './panels/index.js';
import { useDashboard } from './useDashboard.js';
import { initialState } from '../core/source.js';
import type { SourceState } from '../core/source.js';
import type { CalendarData } from '../sources/google-calendar.js';
import type { TodoData } from '../sources/todo.js';
import { formatCountdown } from '../core/time.js';

function StatusLine({ count }: { count: number }) {
  return (
    <Box paddingX={1}>
      <Text bold color="cyan">
        reveille
      </Text>
      <Text dimColor> — {count} source(s) · press q to quit</Text>
    </Box>
  );
}

function dataFor<T>(states: Map<string, SourceState>, id: string): T | undefined {
  const s = states.get(id);
  return s && (s.status === 'ok' || s.status === 'stale') ? (s.data as T) : undefined;
}

function useNowTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Summary({ states }: { states: Map<string, SourceState> }) {
  const now = useNowTick();
  const cal = dataFor<CalendarData>(states, 'calendar');
  const todo = dataFor<TodoData>(states, 'todo');

  const segments: string[] = [];

  const next = cal?.nextIndex != null ? cal.events[cal.nextIndex] : undefined;
  if (next) segments.push(`Next: ${next.summary} in ${formatCountdown(next.startMs - now)}`);
  if (cal) segments.push(`${cal.events.length} evCan ents`);
  if (todo) segments.push(`${todo.TodoItem.filter((i) => !i.done).length} due`);

  if (segments.length === 0) return null;

  return (
    <Box paddingX={1}>
      <Text bold>{segments.join('  ·  ')}</Text>
    </Box>
  );
}

export interface DashboardProps {
  config: ReveilleConfig;
}

export function Dashboard({ config }: DashboardProps) {
  const { exit } = useApp();

  const cache = useMemo<Cache>(() => new DiskCache(cacheDir()), []);
  const secrets = useMemo(() => createSecretStore(), []);
  const sources = useMemo(() => buildSources(config), [config]);

  const states = useDashboard(sources, {
    cache,
    secrets,
    budgetMs: config.app.budget != null ? config.app.budget * 1000 : undefined,
  });

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) exit();
  });

  return (
    <Box flexDirection="column">
      <StatusLine count={sources.length} />
      <Summary states={states} />
      {sources.length === 0 ? (
        <Box flexDirection="column" padding={1}>
          <Text color="yellow">No sources configured.</Text>
          <Text dimColor>Copy config.example.toml to {configFile()} to begin.</Text>
        </Box>
      ) : (
        <Box flexWrap="wrap" padding={1}>
          {sources.map((source) => (
            <Panel key={source.id}
            title={source.label}
            state={states.get(source.id) ?? initialState()}
            body={bodyFor(source.kind)}
          />
        ))}
        </Box>
      )}
    </Box>
  );
}
