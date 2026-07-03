import type { GithubSourceConfig } from '../config/schema.js';
import { fetchWithTimeout, HttpError } from '../core/http.js';
import type { Source } from '../core/source.js';
import { patProvider } from '../core/token.js';

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';

/**
 * Stop issuing new requests once the hourly quota drops to this many calls. A
 * dashboard refreshes forever, so rather than sleeping until the reset window
 * (up to an hour away) we return partial data flagged `rateLimited` and try again
 * on the next cycle. The floor leaves headroom so we never fully drain the bucket.
 */
const RATE_FLOOR = 15;

/** Pages of unread notifications to count before giving up and reporting "capped". */
const NOTIF_PAGE_CAP = 3;

/** Concurrent per-PR CI lookups. Keeps a large backlog within the fetch timeout
 * without opening enough sockets to trip GitHub's secondary (burst) rate limits. */
const CI_CONCURRENCY = 6;

export type CiState = 'success' | 'failure' | 'pending' | 'none';

export interface PrSummary {
  repo: string; // "owner/name"
  number: number;
  title: string;
  author: string;
  url: string; // html_url
  ci: CiState | null; // null when not fetched (review-requests) or unknowable
}

export interface GithubData {
  reviewRequests: PrSummary[] | null; // null => section disabled in config
  myPrs: PrSummary[] | null;
  notifications: number | null;
  notificationsCapped: boolean; // true => count hit NOTIF_PAGE_CAP (there may be more)
  rateRemaining: number | null; // X-RateLimit-Remaining after the last call
  rateLimited: boolean; // true => we stopped a fan-out early to protect the quota
}

/**
 * GitHub PRs/notifications for the token's own account. Auth is a PAT resolved
 * from the config `secret` (keychain/env) and sent as a Bearer token — the same
 * identity `@me` resolves to in the search queries, so no username config is needed.
 *
 * Every section is best-effort and rate-limit aware: a slow section, a hit quota,
 * or a per-PR CI lookup that fails degrades to partial data rather than sinking the
 * whole panel. Only a total failure (bad token, network down) propagates, letting
 * the orchestrator fall back to cached data.
 */
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
          if (err instanceof RateLimitStop) return; // partial data; flagged below
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
        // CI needs the head SHA, so each PR costs a detail + check-runs call. This
        // is the fan-out `maxPrs` bounds; run it with bounded concurrency, and skip
        // any PR not yet started once the quota floor trips.
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

      // Every enabled section hard-failed (bad token, network down): surface the
      // error so the orchestrator shows cached data instead of an empty board. A
      // rate-limit stop is not a failure — it yields partial data.
      if (attempted > 0 && errors.length === attempted) throw errors[0];

      return data;
    },
  };
}

// ---- HTTP client -------------------------------------------------------------

/** Thrown internally when we choose to stop rather than spend the last of the quota. */
class RateLimitStop extends Error {}

class GithubClient {
  /** X-RateLimit-Remaining from the most recent response, or null before the first call. */
  remaining: number | null = null;
  /** Set once we back off; sections in progress observe it and stop fanning out. */
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

  /**
   * One request. Refuses to fire (throwing RateLimitStop) once the tracked quota
   * is at the floor, records `X-RateLimit-Remaining` from the response, and treats
   * a 403/429 with an exhausted quota as a graceful stop rather than a hard error.
   */
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

  /** GET a single JSON resource. `path` is relative to the API root. */
  async get<T>(path: string): Promise<T> {
    const res = await this.request(API + path);
    return (await res.json()) as T;
  }

  /**
   * Follow `Link: rel="next"` pagination, accumulating array items (or the `.items`
   * of a search response) until `cap` is reached, no next page remains, or the quota
   * runs out. `more` reports whether results were left unfetched (cap hit, next page
   * pending, or a rate-limit stop) so callers can show a "there's more" hint.
   */
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

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Extract the `rel="next"` URL from a `Link` header, or null when there's no next page. */
function nextLink(res: Response): string | null {
  const link = res.headers.get('link');
  if (!link) return null;
  const m = /<([^>]+)>;\s*rel="next"/.exec(link);
  return m?.[1] ?? null;
}

// ---- Section helpers ---------------------------------------------------------

/** A search-issues result item — the subset we read for a PR row. */
interface SearchItem {
  number: number;
  title: string;
  html_url: string;
  repository_url: string; // https://api.github.com/repos/owner/name
  user?: { login?: string };
}

/** Build a `/search/issues` path for a query, pulling a full page at a time. */
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
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | timed_out | ...
}

const FAILING_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
  'stale',
]);

/** Collapse a PR's check runs to one headline state. Failure dominates a still-running mix. */
function aggregateCi(runs: CheckRun[]): CiState {
  if (runs.length === 0) return 'none';
  const failed = runs.some((r) => r.conclusion != null && FAILING_CONCLUSIONS.has(r.conclusion));
  if (failed) return 'failure';
  if (runs.some((r) => r.status !== 'completed')) return 'pending';
  return 'success';
}

/** CI state for one PR: head SHA from the PR detail, then its check runs. Best-effort. */
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
    // RateLimitStop already flipped `client.rateLimited`; any other per-PR failure
    // shouldn't sink the panel — CI is a nice-to-have, so degrade to unknown.
    return null;
  }
}
