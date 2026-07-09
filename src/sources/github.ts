import type { GithubSourceConfig } from '../config/schema.js';
import { fetchWithTimeout, HttpError } from '../core/http.js';
import type { Source } from '../core/source.js';
import { patProvider } from '../core/token.js';

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';

const RATE_FLOOR = 15;

const NOTIF_PAGE_CAP = 3;

const CI_CONCURRENCY = 6;

export type CiState = 'success' | 'failure' | 'pending' | 'none';

export interface PrSummary {
  repo: string;
  number: number;
  title: string;
  author: string;
  url: string;
  ci: CiState | null;
}

export interface GithubData {
  reviewRequests: PrSummary[] | null;
  myPrs: PrSummary[] | null;
  notifications: number | null;
  notificationsCapped: boolean;
  rateRemaining: number | null;
  rateLimited: boolean;
}

export function githubSource(cfg: GithubSourceConfig): Source<GithubData> {
  return {
    id: cfg.id,
    kind: 'github',
    label: cfg.title ?? 'GitHub',
    ttl: (cfg.refresh ?? 120) * 1000,
    timeout: 30_000,
    async fetch(ctx) {
      const token = await patProvider(cfg.secret, ctx.secrets).token();
      const client = new GithubClient(token, ctx.signal);

      const data: GithubData = {
        reviewRequests: null,
        myPrs: null,
        notifications: null,
        notificationsCapped: false,
        rateRemaining: null,
        rateLimited: false,
      };

      const errors: Error[] = [];
      let attempted = 0;
      const run = async (enabled: boolean, fn: () => Promise<void>): Promise<void> => {
        if (!enabled) return;
        attempted += 1;
        try {
          await fn();
        } catch (err) {
          if (err instanceof RateLimitStop) return;
          errors.push(err as Error);
        }
      };

      await run(cfg.reviewRequests, async () => {
        const { items } = await client.paginate<SearchItem>(
          searchPath('is:open is:pr review-requested:@me archived:false'),
          cfg.maxPrs,
        );
        data.reviewRequests = items.map(toPr);
      });

      await run(cfg.myPrs, async () => {
        const { items } = await client.paginate<SearchItem>(
          searchPath('is:open is:pr author:@me archived:false'),
          cfg.maxPrs,
        );
        const prs = items.map(toPr);
        await mapPool(prs, CI_CONCURRENCY, async (pr) => {
          if (!client.rateLimited) pr.ci = await ciFor(client, pr);
        });
        data.myPrs = prs;
      });

      await run(cfg.notifications, async () => {
        const { items, more } = await client.paginate<unknown>(
          '/notifications?per_page=100',
          NOTIF_PAGE_CAP * 100,
        );
        data.notifications = items.length;
        data.notificationsCapped = more;
      });

      data.rateRemaining = client.remaining;
      data.rateLimited = client.rateLimited;

      if (attempted > 0 && errors.length === attempted) throw errors[0];

      return data;
    },
  };
}

class RateLimitStop extends Error {}

class GithubClient {
  remaining: number | null = null;
  rateLimited = false;

  constructor(
    private readonly token: string,
    private readonly signal: AbortSignal,
  ) {}

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': API_VERSION,
      'user-agent': 'reveille',
    };
  }

  private async request(url: string): Promise<Response> {
    if (this.remaining != null && this.remaining <= RATE_FLOOR) {
      this.rateLimited = true;
      throw new RateLimitStop();
    }
    const res = await fetchWithTimeout(url, { signal: this.signal, headers: this.headers() });

    const rem = res.headers.get('x-ratelimit-remaining');
    if (rem != null) this.remaining = Number(rem);

    if (
      (res.status === 403 || res.status === 429) &&
      (this.remaining === 0 || res.headers.get('retry-after') != null)
    ) {
      this.rateLimited = true;
      throw new RateLimitStop();
    }
    if (!res.ok) throw new HttpError(res.status, res.statusText, url);
    return res;
  }

  async get<T>(path: string): Promise<T> {
    const res = await this.request(API + path);
    return (await res.json()) as T;
  }

  async paginate<T>(path: string, cap: number): Promise<{ items: T[]; more: boolean }> {
    const items: T[] = [];
    let url: string | null = API + path;
    while (url && items.length < cap) {
      let res: Response;
      try {
        res = await this.request(url);
      } catch (err) {
        if (err instanceof RateLimitStop) return { items: items.slice(0, cap), more: true };
        throw err;
      }
      const body = (await res.json()) as unknown;
      const batch = (Array.isArray(body) ? body : ((body as { items?: T[] }).items ?? [])) as T[];
      items.push(...batch);
      url = nextLink(res);
    }
    return { items: items.slice(0, cap), more: url != null || items.length > cap };
  }
}

async function mapPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function nextLink(res: Response): string | null {
  const link = res.headers.get('link');
  if (!link) return null;
  const m = /<([^>]+)>;\s*rel="next"/.exec(link);
  return m?.[1] ?? null;
}

interface SearchItem {
  number: number;
  title: string;
  html_url: string;
  repository_url: string;
  user?: { login?: string };
}

function searchPath(query: string): string {
  return `/search/issues?${new URLSearchParams({ q: query, per_page: '100' })}`;
}

function toPr(it: SearchItem): PrSummary {
  return {
    repo: it.repository_url.replace(/^.*\/repos\//, ''),
    number: it.number,
    title: it.title,
    author: it.user?.login ?? '',
    url: it.html_url,
    ci: null,
  };
}

interface CheckRun {
  status: string;
  conclusion: string | null;
}

const FAILING_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
  'stale',
]);

function aggregateCi(runs: CheckRun[]): CiState {
  if (runs.length === 0) return 'none';
  const failed = runs.some((r) => r.conclusion != null && FAILING_CONCLUSIONS.has(r.conclusion));
  if (failed) return 'failure';
  if (runs.some((r) => r.status !== 'completed')) return 'pending';
  return 'success';
}

async function ciFor(client: GithubClient, pr: PrSummary): Promise<CiState | null> {
  try {
    const detail = await client.get<{ head?: { sha?: string } }>(
      `/repos/${pr.repo}/pulls/${pr.number}`,
    );
    const sha = detail.head?.sha;
    if (!sha) return null;
    const runs = await client.get<{ check_runs?: CheckRun[] }>(
      `/repos/${pr.repo}/commits/${sha}/check-runs?per_page=100`,
    );
    return aggregateCi(runs.check_runs ?? []);
  } catch {
    return null;
  }
}
