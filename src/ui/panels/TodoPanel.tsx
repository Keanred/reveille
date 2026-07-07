import { Box, Text } from 'ink';
import type { TodoData } from '../../sources/todo.js';

export function TodoPanel({ data }: { data: TodoData }) {
  const items = data.TodoItem;
  if (items.length === 0) return <Text dimColor>nothing today</Text>;

  const done = items.filter((i) => i.done).length;

  return (
    <Box flexDirection="column">
      <Text dimColor>
        {done} of {items.length} done
      </Text>
      {items.map((item, i) => (
        <Text key={i} dimColor={item.done} strikethrough={item.done}>
          {item.done ? '✓' : '○'} {item.text}
        </Text>
      ))}
    </Box>
  );
}
