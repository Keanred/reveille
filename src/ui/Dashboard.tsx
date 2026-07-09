import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, measureElement, useApp, useInput, useStdout, type DOMElement } from 'ink';
import { cacheDir, configFile } from '../config/load.js';
import type { ReveilleConfig } from '../config/schema.js';
import type { Cache } from '../core/cache.js';
import { DiskCache } from '../core/cache.js';
import { createSecretStore } from '../core/secrets.js';
import { buildSources } from '../sources/registry.js';
import { Panel, PANEL_WIDTH } from './Panel.js';
import { bodyFor } from './panels/index.js';
import { useDashboard } from './useDashboard.js';
import { initialState } from '../core/source.js';
import type { Source, SourceState } from '../core/source.js';
import { resolveTheme } from './theme.js';
import { ThemeProvider } from './theme.js';
import { useTheme } from './theme.js';
import { summarySegments } from '../core/summary.js';

function StatusLine({ count }: { count: number }) {
  const theme = useTheme();
  return (
    <Box paddingX={1}>
      <Text bold color={theme.accent}>
        reveille
      </Text>
      <Text dimColor> — {count} source(s) · press q to quit</Text>
    </Box>
  );
}

function useNowTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Summary({
  sources,
  states,
}: {
  sources: readonly Source[];
  states: Map<string, SourceState>;
}) {
  const now = useNowTick();
  const segments = summarySegments(sources, states, now);

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
  const theme = useMemo(() => resolveTheme(config.app.theme, config.theme), [config]);

  const states = useDashboard(sources, {
    cache,
    secrets,
    budgetMs: config.app.budget != null ? config.app.budget * 1000 : undefined,
  });

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) exit();
  });

  const { stdout } = useStdout();
  const termCols = stdout?.columns ?? 80;
  const numCols = Math.max(1, Math.floor(termCols / (PANEL_WIDTH + 2)));

  // Measure each panel's rendered height so we can balance the columns. Falls back
  // to a nominal height until the first measurement lands (which makes the initial
  // pack a plain round-robin), then refines to real heights.
  const refs = useRef<Map<string, DOMElement>>(new Map());
  const [heights, setHeights] = useState<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    let changed = false;
    for (const source of sources) {
      const el = refs.current.get(source.id);
      if (!el) continue;
      const h = measureElement(el).height;
      next.set(source.id, h);
      if (heights.get(source.id) !== h) changed = true;
    }
    if (changed || next.size !== heights.size) setHeights(next);
  });

  // Masonry: place each panel into whichever column is currently shortest, so the
  // column bottoms stay roughly even regardless of how tall individual panels are.
  const NOMINAL_HEIGHT = 5;
  const colHeights = new Array<number>(numCols).fill(0);
  const columns: (typeof sources)[] = Array.from({ length: numCols }, () => []);
  for (const source of sources) {
    const shortest = colHeights.indexOf(Math.min(...colHeights));
    columns[shortest]!.push(source);
    colHeights[shortest]! += (heights.get(source.id) ?? NOMINAL_HEIGHT) + 1; // +1 = marginBottom
  }

  return (
    <ThemeProvider theme={theme}>
      <Box flexDirection="column">
        <StatusLine count={sources.length} />
        <Summary sources={sources} states={states} />
        {sources.length === 0 ? (
          <Box flexDirection="column" padding={1}>
            <Text color={theme.warn}>No sources configured.</Text>
            <Text dimColor>Run `reveille init` to create a starter config at {configFile()}.</Text>
          </Box>
        ) : (
          <Box padding={1}>
            {columns.map((col, ci) => (
              <Box key={ci} flexDirection="column">
                {col.map((source) => (
                  <Box key={source.id} ref={(el) => void (el && refs.current.set(source.id, el))}>
                    <Panel
                      title={source.label}
                      state={states.get(source.id) ?? initialState()}
                      body={bodyFor(source.kind)}
                    />
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </ThemeProvider>
  );
}
