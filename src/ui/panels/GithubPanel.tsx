import { Text } from 'ink';
import type { ReactNode } from 'react';
import type { GithubData } from '../../sources/github.js';
import { useTheme } from '../theme.js';

export function GithubPanel({ data }: { data: GithubData }) {
  const theme = useTheme();
  const chips: ReactNode[] = [];

  if (data.reviewRequests) {
    chips.push(<Text key="review">{data.reviewRequests.length} to review</Text>);
  }

  if (data.myPrs) {
    const failing = data.myPrs.filter((p) => p.ci === 'failure').length;
    const pending = data.myPrs.filter((p) => p.ci === 'pending').length;
    chips.push(
      <Text key="prs">
        {data.myPrs.length} open
        {failing > 0 && <Text color={theme.error}> {failing}✗</Text>}
        {pending > 0 && <Text color={theme.warn}> {pending}…</Text>}
      </Text>,
    );
  }

  if (data.notifications != null) {
    chips.push(
      <Text key="notif">
        {data.notifications}
        {data.notificationsCapped ? '+' : ''} unread
      </Text>,
    );
  }

  if (data.rateLimited) {
    chips.push(
      <Text key="rate" color={theme.warn} dimColor>
        rate-limited
      </Text>,
    );
  }

  if (chips.length === 0) return <Text dimColor>nothing to show</Text>;

  return (
    <Text>
      {chips.map((chip, i) => (
        <Text key={i}>
          {i > 0 ? '  ·  ' : ''}
          {chip}
        </Text>
      ))}
    </Text>
  );
}
