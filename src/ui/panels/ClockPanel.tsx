import { Text } from 'ink';
import type { ClockData } from '../../sources/clock.js';

export function ClockPanel({ data }: { data: ClockData }) {
  return <Text>{data.display}</Text>;
}
