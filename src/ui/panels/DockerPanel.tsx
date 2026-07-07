import { Box, Text } from 'ink';
import type { DockerData } from '../../sources/docker.js';

type Health = 'healthy' | 'unhealthy' | 'restarting' | 'up' | 'other';

function classify(status: string): Health {
  if (/\(unhealthy\)/i.test(status)) return 'unhealthy';
  if (/\(healthy\)/i.test(status)) return 'healthy';
  if (/^restarting/i.test(status)) return 'restarting';
  if (/^up\b/i.test(status)) return 'up';
  return 'other';
}

const COLOR: Record<Health, string | undefined> = {
  healthy: 'green',
  up: 'green',
  unhealthy: 'yellow',
  restarting: 'yellow',
  other: undefined,
};

export function DockerPanel({ data }: { data: DockerData }) {
  const { containers } = data;
  if (containers.length === 0) return <Text dimColor>no running containers</Text>;

  const unhealthy = containers.filter((c) => classify(c.status) === 'unhealthy').length;
  const restarting = containers.filter((c) => classify(c.status) === 'restarting').length;

  const summary = [`${containers.length} running`];
  if (unhealthy) summary.push(`${unhealthy} unhealthy`);
  if (restarting) summary.push(`${restarting} restarting`);

  const nameWidth = Math.max(...containers.map((c) => c.name.length));

  return (
    <Box flexDirection="column">
      <Text dimColor>{summary.join('  ·  ')}</Text>
      {containers.map((c) => {
        const health = classify(c.status);
        return (
          <Text key={c.name}>
            <Text color={COLOR[health]}>●</Text> {c.name.padEnd(nameWidth)}{' '}
            <Text dimColor>{c.status}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
