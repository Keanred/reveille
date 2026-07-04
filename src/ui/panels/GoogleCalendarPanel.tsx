import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import type { CalendarData } from '../../sources/google-calendar.js';
import { formatClock, formatCountdown } from '../../core/time.js';

/**
 * Presentational body for a Google Calendar source: today's events, with the next
 * one highlighted and a live countdown. The countdown ticks locally each second so
 * it stays accurate between the source's (slower) refreshes.
 */
export function GoogleCalendarPanel({ data }: { data: CalendarData }) {
  const now = useNowTick(data.nextIndex != null);

  if (data.events.length === 0) return <Text dimColor>no events today</Text>;

  const next = data.nextIndex != null ? data.events[data.nextIndex] : undefined;

  return (
    <Box flexDirection="column">
      {next && (
        <Text>
          next: <Text bold>{next.summary}</Text> in{' '}
          <Text color="cyan">{formatCountdown(next.startMs - now)}</Text>
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

/** Re-render once a second (only while there's something to count down to). */
function useNowTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
