import { Text } from 'ink';
import type { HeadlineData } from '../../sources/headline.js';

export function HeadlinePanel({ data }: { data: HeadlineData }) {
  if (!data.text) return <Text dimColor>no headline</Text>;
  return <Text>{data.text}</Text>;
}
