import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import type { SourceState, SourceStatus } from '../core/source.js';

const STATUS_BADGE: Record<SourceStatus, { label: string; color: string }> = {
  loading: { label: '⟳', color: 'cyan' },
  ok: { label: '●', color: 'green' },
  stale: { label: '◐', color: 'yellow' },
  error: { label: '✗', color: 'red' },
};

function relativeTime(fetchedAt: number | undefined): string {
  if (fetchedAt == null) return 'never';
  const seconds = Math.round((Date.now() - fetchedAt) / 1000);
  if (seconds < 1) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

export interface PanelProps<T> {
  title: string;
  state: SourceState<T>;
  body: (data: T) => ReactNode;
}

export function Panel<T>({ title, state, body }: PanelProps<T>) {
  const badge = STATUS_BADGE[state.status];
  const fetchedAt = state.status === 'ok' || state.status === 'stale' ? state.fetchedAt : undefined;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={badge.color}
      paddingX={1}
      marginRight={1}
      marginBottom={1}
      minWidth={28}
    >
      <Box justifyContent="space-between">
        <Text bold>{title}</Text>
        <Text color={badge.color}>{badge.label}</Text>
      </Box>

      {renderBody(state, body)}

      {state.status === 'stale' ? (
        <Text color="yellow" dimColor>
          ↻ {relativeTime(fetchedAt)}
        </Text>
      ) : (
        <Text dimColor>updated {relativeTime(fetchedAt)}</Text>
      )}
    </Box>
  );
}

function renderBody<T>(state: SourceState<T>, body: (data: T) => ReactNode): ReactNode {
  if (state.status === 'error') {
    return <Text color="red">{state.error.message}</Text>;
  }
  if (state.status === 'loading') {
    return <Text dimColor>loading…</Text>;
  }
  // Render stale body as-is: wrapping a <Box> body in <Text> crashes Ink.
  if (state.status === 'stale') {
    return body(state.data);
  }
  return body(state.data);
}
