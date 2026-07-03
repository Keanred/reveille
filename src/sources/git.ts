import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import type { GitSourceConfig } from '../config/schema.js';
import type { Source } from '../core/source.js';

const execFileAsync = promisify(execFile);

/** Per-repo scan result. `error` is set (and the other fields are best-effort) when the scan fails. */
export interface RepoStatus {
  path: string;
  name: string; // basename of the path — the row label
  branch: string | null; // null when detached or on an unborn branch
  detached: boolean;
  dirty: boolean;
  dirtyCount: number; // number of changed/untracked entries
  ahead: number; // commits HEAD is ahead of upstream (0 if no upstream)
  behind: number; // commits HEAD is behind upstream (0 if no upstream)
  lastCommitAt: number | null; // epoch ms of the last commit, or null on an empty repo
  error: string | null; // not-a-repo / git-missing / timed-out / etc.
}

export interface GitData {
  repos: RepoStatus[];
}

/**
 * Scans a configured list of git working directories in parallel and reports, per
 * repo, dirty/clean, ahead/behind vs upstream, and last-commit age.
 *
 * The concurrency lives here: `fetch` fans out across every repo with `Promise.all`,
 * and each repo carries its own `repoTimeout` budget (combined with the orchestrator's
 * abort signal). A slow or hung repo therefore degrades to a single error *row* rather
 * than stalling the whole panel — and nothing here blocks the render loop.
 */
export function gitSource(cfg: GitSourceConfig): Source<GitData> {
  return {
    id: cfg.id,
    kind: 'git',
    label: cfg.title ?? 'Repositories',
    ttl: (cfg.refresh ?? 30) * 1000,
    // Whole-panel ceiling. Per-repo budgets are tighter, so this is just a backstop
    // for the fan-out as a whole (e.g. a huge repo list).
    timeout: 15_000,
    async fetch(ctx) {
      const repos = await Promise.all(
        cfg.repos.map((path) => scanRepo(expandPath(path), cfg, ctx.signal)),
      );
      return { repos };
    },
  };
}

/**
 * Scans one repo. Never rejects: any failure (missing git, not a repo, timeout,
 * abort) is caught and returned as a RepoStatus with `error` set, so one bad repo
 * can't take down the panel.
 */
async function scanRepo(
  path: string,
  cfg: GitSourceConfig,
  parent: AbortSignal,
): Promise<RepoStatus> {
  const base: RepoStatus = {
    path,
    name: basename(path) || path,
    branch: null,
    detached: false,
    dirty: false,
    dirtyCount: 0,
    ahead: 0,
    behind: 0,
    lastCommitAt: null,
    error: null,
  };

  // Each repo gets its own deadline, combined with the orchestrator's abort signal.
  const signal = AbortSignal.any([parent, AbortSignal.timeout(cfg.repoTimeout * 1000)]);

  try {
    if (cfg.fetchRemote) {
      // Refresh remote-tracking refs so ahead/behind is live. Network — bounded by `signal`.
      await runGit(path, ['fetch', '--quiet'], signal);
    }

    // One call yields branch, ahead/behind, and every dirty entry.
    const status = parseStatus(await runGit(path, ['status', '--porcelain=v2', '--branch'], signal));

    // A second, cheap call for last-commit age. Empty repo (no commits) exits nonzero;
    // treat that as "no last commit" rather than an error.
    const lastCommitAt = await lastCommit(path, signal);

    return { ...base, ...status, lastCommitAt };
  } catch (err) {
    return { ...base, error: describeError(err) };
  }
}

/** Runs `git -C <path> …` and returns stdout, throwing on nonzero exit / abort. */
async function runGit(path: string, args: string[], signal: AbortSignal): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', path, ...args], {
    signal,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024, // a very dirty repo can emit a lot of status lines
  });
  return stdout;
}

/** Parses `git status --porcelain=v2 --branch` output. */
function parseStatus(out: string): Pick<
  RepoStatus,
  'branch' | 'detached' | 'dirty' | 'dirtyCount' | 'ahead' | 'behind'
> {
  let branch: string | null = null;
  let detached = false;
  let ahead = 0;
  let behind = 0;
  let dirtyCount = 0;

  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim();
      if (head === '(detached)') detached = true;
      else branch = head;
    } else if (line.startsWith('# branch.ab ')) {
      // Format: "+<ahead> -<behind>". Absent entirely when there's no upstream.
      const m = /\+(\d+)\s+-(\d+)/.exec(line);
      if (m) {
        ahead = Number(m[1]);
        behind = Number(m[2]);
      }
    } else if (line && !line.startsWith('#')) {
      // Any non-header line is a changed/untracked entry: 1, 2 (rename/copy), u, ?.
      dirtyCount += 1;
    }
  }

  return { branch, detached, dirty: dirtyCount > 0, dirtyCount, ahead, behind };
}

/** Last commit time in epoch ms, or null for a repo with no commits. */
async function lastCommit(path: string, signal: AbortSignal): Promise<number | null> {
  try {
    const out = await runGit(path, ['log', '-1', '--format=%ct'], signal);
    const seconds = Number(out.trim());
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  } catch {
    return null; // unborn branch / empty repo — not a scan failure
  }
}

/** Turns a repo path with `~` or `$VAR` into an absolute path. */
function expandPath(p: string): string {
  let out = p.startsWith('~') ? homedir() + p.slice(1) : p;
  out = out.replace(/\$\{?(\w+)\}?/g, (_, name) => process.env[name] ?? '');
  return out;
}

/** Maps a thrown git/exec error to a short, human-readable row message. */
function describeError(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stderr?: string; code?: string | number };
  if (e.code === 'ENOENT') return 'git not found on PATH';
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return 'timed out';
  const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
  if (/not a git repository/i.test(stderr)) return 'not a git repository';
  return stderr.split('\n')[0] || e.message || 'scan failed';
}
