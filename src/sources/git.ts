import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import type { GitSourceConfig } from '../config/schema.js';
import type { Source } from '../core/source.js';

const execFileAsync = promisify(execFile);

export interface RepoStatus {
  path: string;
  name: string;
  branch: string | null;
  detached: boolean;
  dirty: boolean;
  dirtyCount: number;
  ahead: number;
  behind: number;
  lastCommitAt: number | null;
  error: string | null;
}

export interface GitData {
  repos: RepoStatus[];
}

export function gitSource(cfg: GitSourceConfig): Source<GitData> {
  return {
    id: cfg.id,
    kind: 'git',
    label: cfg.title ?? 'Repositories',
    ttl: (cfg.refresh ?? 30) * 1000,
    timeout: 15_000,
    async fetch(ctx) {
      const repos = await Promise.all(
        cfg.repos.map((path) => scanRepo(expandPath(path), cfg, ctx.signal)),
      );
      return { repos };
    },
  };
}

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

  const signal = AbortSignal.any([parent, AbortSignal.timeout(cfg.repoTimeout * 1000)]);

  try {
    if (cfg.fetchRemote) {
      await runGit(path, ['fetch', '--quiet'], signal);
    }

    const status = parseStatus(
      await runGit(path, ['status', '--porcelain=v2', '--branch'], signal),
    );

    const lastCommitAt = await lastCommit(path, signal);

    return { ...base, ...status, lastCommitAt };
  } catch (err) {
    return { ...base, error: describeError(err) };
  }
}

async function runGit(path: string, args: string[], signal: AbortSignal): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', path, ...args], {
    signal,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

function parseStatus(
  out: string,
): Pick<RepoStatus, 'branch' | 'detached' | 'dirty' | 'dirtyCount' | 'ahead' | 'behind'> {
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
      const m = /\+(\d+)\s+-(\d+)/.exec(line);
      if (m) {
        ahead = Number(m[1]);
        behind = Number(m[2]);
      }
    } else if (line && !line.startsWith('#')) {
      dirtyCount += 1;
    }
  }

  return { branch, detached, dirty: dirtyCount > 0, dirtyCount, ahead, behind };
}

async function lastCommit(path: string, signal: AbortSignal): Promise<number | null> {
  try {
    const out = await runGit(path, ['log', '-1', '--format=%ct'], signal);
    const seconds = Number(out.trim());
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  } catch {
    return null;
  }
}

function expandPath(p: string): string {
  let out = p.startsWith('~') ? homedir() + p.slice(1) : p;
  out = out.replace(/\$\{?(\w+)\}?/g, (_, name) => process.env[name] ?? '');
  return out;
}

function describeError(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stderr?: string; code?: string | number };
  if (e.code === 'ENOENT') return 'git not found on PATH';
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return 'timed out';
  const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
  if (/not a git repository/i.test(stderr)) return 'not a git repository';
  return stderr.split('\n')[0] || e.message || 'scan failed';
}
