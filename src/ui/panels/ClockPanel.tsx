import { Text } from 'ink';
import type { ClockData } from '../../sources/clock.js';

/** Presentational body for a clock source. */
export function ClockPanel({ data }: { data: ClockData }) {
  return <Text>{data.display}</Text>;
}
