import { useMemo } from 'react';
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

export interface DashboardProps {
  config: ReveilleConfig;
}

/** Root view: wires config -> sources -> panels, draws the status line, handles quit keys. */
export function Dashboard({ config }: DashboardProps) {
  const { exit } = useApp();

  // Stable singletons for the lifetime of the app.
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
