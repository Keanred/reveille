import { Text } from 'ink';
import type { DaylightData } from '../../sources/daylight.js';
import { formatClock } from '../../core/time.js';

export function DaylightPanel({ data }: { data: DaylightData }) {
  if (data.state === 'midnight-sun') return <Text>☀ midnight sun</Text>;
  if (data.state === 'polar-night') return <Text dimColor>night all day</Text>;
  const rise = formatClock(data.sunrise!, data.zone);
  const set = formatClock(data.sunset!, data.zone);
  return (
    <Text>
      ☀ {rise} → {set}
    </Text>
  );
}
