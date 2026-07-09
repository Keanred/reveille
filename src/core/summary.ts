import type { Source, SourceState } from '../core/source.js';
import type { CalendarData } from '../sources/google-calendar.js';
import type { TodoData } from '../sources/todo.js';
import { formatCountdown } from '../core/time.js';

function dataFor<T>(states: Map<string, SourceState>, id: string): T | undefined {
  const s = states.get(id);
  return s && (s.status === 'ok' || s.status === 'stale') ? (s.data as T) : undefined;
}

export function summarySegments(
  sources: readonly Source[],
  states: Map<string, SourceState>,
  now: number,
): string[] {
  const calId = sources.find((s) => s.kind === 'google-calendar')?.id;
  const todoId = sources.find((s) => s.kind === 'todo')?.id;
  const cal = calId ? dataFor<CalendarData>(states, calId) : undefined;
  const todo = todoId ? dataFor<TodoData>(states, todoId) : undefined;
  const segments: string[] = [];

  const next = cal?.nextIndex != null ? cal.events[cal.nextIndex] : undefined;
  if (next) segments.push(`Next: ${next.summary} in ${formatCountdown(next.startMs - now)}`);
  if (cal) segments.push(`${cal.events.length} events`);
  if (todo) segments.push(`${todo.TodoItem.filter((i) => !i.done).length} due`);

  return segments;
}

export function formatSummary(
  sources: readonly Source[],
  states: Map<string, SourceState>,
  now: number,
): string {
  return summarySegments(sources, states, now).join('  ·  ');
}
