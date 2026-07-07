import { Text } from 'ink';
import type { GitData } from '../../sources/git.js';

export function GitPanel({ data }: { data: GitData }) {
  const repos = data.repos;
  if (!repos.length) return <Text>no repositories configured</Text>;

  const dirty = repos.filter((r) => r.error == null && r.dirty).length;
  const errors = repos.filter((r) => r.error != null).length;
  const ahead = repos.reduce((sum, r) => sum + r.ahead, 0);
  const behind = repos.reduce((sum, r) => sum + r.behind, 0);

  const bits = [`${repos.length} repos`];
  if (dirty) bits.push(`${dirty} dirty`);
  if (errors) bits.push(`${errors} errors`);
  if (ahead) bits.push(`↑${ahead}`);
  if (behind) bits.push(`↓${behind}`);

  return <Text>{bits.join('  ·  ')}</Text>;
}
