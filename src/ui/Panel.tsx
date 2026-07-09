import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import type { SourceState, SourceStatus } from '../core/source.js';
import { useTheme, type Theme } from './theme.js';
import { friendlyError } from '../core/errors.js';

export const PANEL_WIDTH = 46;

const STATUS_BADGE: Record<SourceStatus, { label: string; role: keyof Theme }> = {
  loading: { label: '⟳', role: 'accent' },
  ok: { label: '●', role: 'ok' },
  stale: { label: '◐', role: 'warn' },
  error: { label: '✗', role: 'error' },
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
  const theme = useTheme();
  const badge = STATUS_BADGE[state.status];
  const color = theme[badge.role];
  const fetchedAt = state.status === 'ok' || state.status === 'stale' ? state.fetchedAt : undefined;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color}
      paddingX={1}
      marginRight={1}
      marginBottom={1}
      width={PANEL_WIDTH}
    >
      <Box justifyContent="space-between">
        <Text bold>{title}</Text>
        <Text color={color}>{badge.label}</Text>
      </Box>

      {renderBody(state, body, theme)}

      {state.status === 'stale' ? (
        <Text color={theme.warn} dimColor wrap="truncate-end">
          ↻ {relativeTime(fetchedAt)} · {friendlyError(state.error)}
        </Text>
      ) : (
        <Text dimColor>updated {relativeTime(fetchedAt)}</Text>
      )}
    </Box>
  );
}

function renderBody<T>(
  state: SourceState<T>,
  body: (data: T) => ReactNode,
  theme: Theme,
): ReactNode {
  if (state.status === 'error') {
    return (
      <Text wrap="truncate-end" color={theme.error}>
        {friendlyError(state.error)}
      </Text>
    );
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
