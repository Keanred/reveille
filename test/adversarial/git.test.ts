import { describe, expect, it, vi } from 'vitest';
import type { GitSourceConfig } from '../../src/config/schema.js';
import { MemoryCache } from '../../src/core/cache.js';
import type { SecretStore } from '../../src/core/secrets.js';
import type { SourceContext } from '../../src/core/source.js';

// git.ts shells out via `execFile`; drive it with a per-test handler keyed off the
// git arguments (which include `-C <path>`), so we can simulate any repo state —
// or a failure — without touching a real repository.
const mock = vi.hoisted(() => ({
  handler: (_args: string[]): { stdout: string } => ({ stdout: '' }),
}));

vi.mock('node:child_process', () => ({
  execFile: (
    _file: string,
    args: string[],
    _opts: unknown,
    cb: (err: unknown, res?: { stdout: string; stderr?: string }) => void,
  ) => {
    try {
      cb(null, { ...mock.handler(args), stderr: '' });
    } catch (err) {
      cb(err);
    }
  },
}));

const { gitSource } = await import('../../src/sources/git.js');

const noSecrets: SecretStore = {
  get: async () => undefined,
  set: async () => {},
  delete: async () => false,
};

function ctx(): SourceContext {
  return {
    cache: new MemoryCache(),
    signal: new AbortController().signal,
    now: () => Date.parse('2026-06-29T12:00:00.000Z'),
    secrets: noSecrets,
  };
}

function cfg(over: Partial<GitSourceConfig> = {}): GitSourceConfig {
  return { id: 'r', type: 'git', repos: ['~/a'], fetchRemote: false, repoTimeout: 3, ...over };
}

const status = (lines: string[]) => lines.join('\n') + '\n';

const DIRTY = status([
  '# branch.oid deadbeef',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 aaa bbb file.ts',
  '? untracked.txt',
]);
const CLEAN = status([
  '# branch.oid deadbeef',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +0 -0',
]);
const DETACHED = status(['# branch.oid deadbeef', '# branch.head (detached)']);
const UNBORN = status(['# branch.oid (initial)', '# branch.head main']);

/** Path passed to `git -C <path> …`, so a handler can branch per repo. */
const repoPath = (args: string[]) => args[args.indexOf('-C') + 1] ?? '';

describe('git source', () => {
  it('parses a dirty repo with ahead/behind and last-commit time', async () => {
    mock.handler = (args) => {
      if (args.includes('status')) return { stdout: DIRTY };
      if (args.includes('log')) return { stdout: '1719662400\n' };
      return { stdout: '' };
    };

    const { repos } = await gitSource(cfg()).fetch(ctx());
    expect(repos[0]).toMatchObject({
      name: 'a',
      branch: 'main',
      detached: false,
      dirty: true,
      dirtyCount: 2,
      ahead: 2,
      behind: 1,
      lastCommitAt: 1719662400 * 1000,
      error: null,
    });
  });

  it('reports a clean repo with no upstream divergence', async () => {
    mock.handler = (args) =>
      args.includes('status') ? { stdout: CLEAN } : { stdout: '1719662400\n' };

    const { repos } = await gitSource(cfg()).fetch(ctx());
    expect(repos[0]).toMatchObject({ dirty: false, dirtyCount: 0, ahead: 0, behind: 0 });
  });

  it('flags a detached HEAD with a null branch', async () => {
    mock.handler = (args) =>
      args.includes('status') ? { stdout: DETACHED } : { stdout: '1719662400\n' };

    const { repos } = await gitSource(cfg()).fetch(ctx());
    expect(repos[0]).toMatchObject({ detached: true, branch: null });
  });

  it('treats an unborn branch (no commits) as null last-commit, not an error', async () => {
    mock.handler = (args) => {
      if (args.includes('status')) return { stdout: UNBORN };
      throw Object.assign(new Error('no commits'), {
        stderr: "fatal: your current branch 'main' does not have any commits yet",
      });
    };

    const { repos } = await gitSource(cfg()).fetch(ctx());
    expect(repos[0]).toMatchObject({ branch: 'main', lastCommitAt: null, error: null });
  });

  it('surfaces a non-repo path as an error row instead of throwing', async () => {
    mock.handler = (args) => {
      if (args.includes('status')) {
        throw Object.assign(new Error('exit 128'), {
          stderr: 'fatal: not a git repository (or any of the parent directories): .git',
        });
      }
      return { stdout: '' };
    };

    const { repos } = await gitSource(cfg()).fetch(ctx());
    expect(repos[0]).toMatchObject({ error: 'not a git repository', lastCommitAt: null });
  });

  it('scans repos independently — one bad repo does not sink the others', async () => {
    mock.handler = (args) => {
      if (repoPath(args).endsWith('/b') && args.includes('status')) {
        throw Object.assign(new Error(), { stderr: 'fatal: not a git repository' });
      }
      if (args.includes('status')) return { stdout: DIRTY };
      return { stdout: '1719662400\n' };
    };

    const { repos } = await gitSource(cfg({ repos: ['~/a', '~/b'] })).fetch(ctx());
    const a = repos.find((r) => r.name === 'a');
    const b = repos.find((r) => r.name === 'b');
    expect(a).toMatchObject({ dirty: true, error: null });
    expect(b?.error).toBe('not a git repository');
  });
});
