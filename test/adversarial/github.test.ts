import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GithubSourceConfig } from '../../src/config/schema.js';
import { MemoryCache } from '../../src/core/cache.js';
import type { SecretStore } from '../../src/core/secrets.js';
import type { SourceContext } from '../../src/core/source.js';
import { githubSource } from '../../src/sources/github.js';

const secrets: SecretStore = {
  get: async () => 'tok',
  set: async () => {},
  delete: async () => false,
};

function ctx(): SourceContext {
  return {
    cache: new MemoryCache(),
    signal: new AbortController().signal,
    now: () => 0,
    secrets,
  };
}

function cfg(over: Partial<GithubSourceConfig> = {}): GithubSourceConfig {
  return {
    id: 'gh',
    type: 'github',
    secret: 'keychain:github-token',
    reviewRequests: true,
    myPrs: true,
    notifications: true,
    maxPrs: 20,
    ...over,
  } as GithubSourceConfig;
}

/** A GitHub search-issues item for repo `owner/name` and PR number. */
function prItem(repo: string, number: number) {
  return {
    number,
    title: `PR ${number}`,
    html_url: `https://github.com/${repo}/pull/${number}`,
    repository_url: `https://api.github.com/repos/${repo}`,
    user: { login: 'me' },
  };
}

function json(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'x-ratelimit-remaining': '4990', ...headers },
  });
}

/** Route a mocked fetch by URL; anything unmatched is a test bug, so we throw loudly. */
function route(fn: (url: string) => Response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => fn(String(input)));
}

afterEach(() => vi.restoreAllMocks());

describe('github source', () => {
  it('fetches every section and shapes the data', async () => {
    route((url) => {
      if (url.includes('/search/issues')) {
        return url.includes('review-requested')
          ? json({ items: [prItem('o/r', 1)] })
          : json({ items: [prItem('o/r', 2)] });
      }
      if (url.includes('/pulls/2')) return json({ head: { sha: 'abc' } });
      if (url.includes('/commits/abc/check-runs')) {
        return json({ check_runs: [{ status: 'completed', conclusion: 'success' }] });
      }
      if (url.includes('/notifications')) return json([{}, {}]);
      throw new Error(`unexpected url ${url}`);
    });

    const data = await githubSource(cfg()).fetch(ctx());

    expect(data.reviewRequests).toHaveLength(1);
    expect(data.reviewRequests?.[0]).toMatchObject({ repo: 'o/r', number: 1, ci: null });
    expect(data.myPrs).toHaveLength(1);
    expect(data.myPrs?.[0]).toMatchObject({ repo: 'o/r', number: 2, ci: 'success' });
    expect(data.notifications).toBe(2);
    expect(data.rateLimited).toBe(false);
  });

  it('rolls CI up to failure when any check run failed', async () => {
    route((url) => {
      if (url.includes('/search/issues')) {
        return url.includes('review-requested')
          ? json({ items: [] })
          : json({ items: [prItem('o/r', 2)] });
      }
      if (url.includes('/pulls/2')) return json({ head: { sha: 'abc' } });
      if (url.includes('/check-runs')) {
        return json({
          check_runs: [
            { status: 'completed', conclusion: 'success' },
            { status: 'completed', conclusion: 'failure' },
          ],
        });
      }
      if (url.includes('/notifications')) return json([]);
      throw new Error(`unexpected url ${url}`);
    });

    const data = await githubSource(cfg()).fetch(ctx());
    expect(data.myPrs?.[0]?.ci).toBe('failure');
  });

  it('backs off (partial data, no more requests) once the quota floor is hit', async () => {
    const spy = route((url) => {
      // The search reports a remaining count at the floor, so the CI fan-out never fires.
      if (url.includes('/search/issues')) {
        return json({ items: [prItem('o/r', 2), prItem('o/r', 3)] }, { 'x-ratelimit-remaining': '10' });
      }
      throw new Error(`should not have requested ${url}`);
    });

    const data = await githubSource(
      cfg({ reviewRequests: false, notifications: false, maxPrs: 5 }),
    ).fetch(ctx());

    expect(data.rateLimited).toBe(true);
    expect(data.rateRemaining).toBe(10);
    expect(data.myPrs).toHaveLength(2);
    expect(data.myPrs?.every((p) => p.ci === null)).toBe(true);
    // Exactly one call (the search) — the per-PR CI lookups were suppressed.
    expect(spy.mock.calls.every(([u]) => String(u).includes('/search/issues'))).toBe(true);
  });

  it('returns partial data when one section fails but others succeed', async () => {
    route((url) => {
      if (url.includes('/search/issues') && url.includes('review-requested')) {
        return new Response('boom', { status: 500, headers: { 'x-ratelimit-remaining': '4990' } });
      }
      if (url.includes('/search/issues')) return json({ items: [prItem('o/r', 2)] });
      if (url.includes('/pulls/2')) return json({ head: { sha: 'abc' } });
      if (url.includes('/check-runs')) {
        return json({ check_runs: [{ status: 'completed', conclusion: 'success' }] });
      }
      if (url.includes('/notifications')) return json([{}]);
      throw new Error(`unexpected url ${url}`);
    });

    const data = await githubSource(cfg()).fetch(ctx());
    expect(data.reviewRequests).toBeNull(); // the failed section
    expect(data.myPrs).toHaveLength(1);
    expect(data.notifications).toBe(1);
  });

  it('throws when every enabled section fails, so the orchestrator can fall back to cache', async () => {
    route(() => new Response('nope', { status: 401 }));
    await expect(githubSource(cfg()).fetch(ctx())).rejects.toThrow();
  });

  it('sends the resolved secret as a Bearer token', async () => {
    const spy = route(() => json({ items: [] }));
    await githubSource(cfg({ myPrs: false, notifications: false })).fetch(ctx());

    const headers = new Headers(spy.mock.calls[0]?.[1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer tok');
  });

  it('follows Link rel="next" pagination across pages', async () => {
    const spy = route((url) => {
      if (url.includes('page=2')) return json({ items: [prItem('o/r', 2)] });
      return json(
        { items: [prItem('o/r', 1)] },
        { link: '<https://api.github.com/search/issues?q=x&page=2>; rel="next"' },
      );
    });

    const data = await githubSource(
      cfg({ myPrs: false, notifications: false, maxPrs: 5 }),
    ).fetch(ctx());

    expect(data.reviewRequests).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
