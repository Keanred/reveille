import { Text } from 'ink';

function preview(data: unknown): string {
  if (data == null) return '—';
  if (typeof data === 'string') return data;
  const json = JSON.stringify(data, null, 2);
  return json.length > 400 ? `${json.slice(0, 400)}…` : json;
}

export function JsonPanel({ data }: { data: unknown }) {
  return <Text>{preview(data)}</Text>;
}
