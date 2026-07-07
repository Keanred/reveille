import { Text } from 'ink';
import type { LocalsData } from '../../sources/locals.js';
import { basename } from 'node:path';

export function LocalsPanel({ data }: { data: LocalsData }) {
  const bits: string[] = [];

  for (const d of data.disks) {
    const label = d.path === '/' ? 'Disk' : basename(d.path) || d.path;
    if (d.error) bits.push(`${label}: ${d.error}`);
    else bits.push(`${label} ${d.usedPct}%  ·  ${formatGB(d.freeBytes)} free`);
  }

  if (data.battery) {
    const b = data.battery;
    bits.push(`🔋 ${b.pct}% ${b.state}${b.time ? ` (${b.time})` : ''}`);
  }

  if (bits.length === 0) return <Text dimColor>no data</Text>;
  return <Text>{bits.join('  ·  ')}</Text>;
}

function formatGB(bytes: number): string {
  return `${Math.round(bytes / 1024 ** 3)} GB`;
}
