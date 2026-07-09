import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import type { CalendarData } from '../../sources/google-calendar.js';
import { formatClock, formatCountdown } from '../../core/time.js';
import { useTheme } from '../theme.js';

export function GoogleCalendarPanel({ data }: { data: CalendarData }) {
  const theme = useTheme();
  const now = useNowTick(data.nextIndex != null);

  if (data.events.length === 0) return <Text dimColor>no events today</Text>;

  const next = data.nextIndex != null ? data.events[data.nextIndex] : undefined;

  return (
    <Box flexDirection="column">
      {next && (
        <Text>
          next: <Text bold>{next.summary}</Text> in{' '}
          <Text color={theme.accent}>{formatCountdown(next.startMs - now)}</Text>
        </Text>
      )}
      {data.events.map((event, i) => {
        const when = event.allDay ? 'all day' : formatClock(event.startMs, data.zone);
        const isNext = i === data.nextIndex;
        const past = event.startMs <= now && !event.allDay;
        return (
          <Text key={event.id} bold={isNext} dimColor={past}>
            {when.padEnd(7)} {event.summary}
          </Text>
        );
      })}
    </Box>
  );
}

function useNowTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
