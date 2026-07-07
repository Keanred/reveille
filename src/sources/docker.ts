import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DockerSourceConfig } from '../config/schema.js';
import type { Source } from '../core/source.js';

const execFileAsync = promisify(execFile);

export interface DockerContainer {
  name: string;
  status: string;
}

export interface DockerData {
  containers: DockerContainer[];
}

export function dockerSource(cfg: DockerSourceConfig): Source<DockerData> {
  return {
    id: cfg.id,
    kind: 'docker',
    label: cfg.title ?? 'Docker',
    ttl: (cfg.refresh ?? 60) * 1000,
    timeout: cfg.timeout * 1000,
    async fetch(ctx) {
      let stdout: string;
      try {
        ({ stdout } = await execFileAsync(
          'docker',
          ['ps', '--format', '{{.Names}}\t{{.Status}}'],
          { signal: ctx.signal, encoding: 'utf8' },
        ));
      } catch (err) {
        throw new Error(describeError(err));
      }

      const containers = stdout
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          const [name = '', status = ''] = line.split('\t');
          return { name, status };
        });

      return { containers };
    },
  };
}

function describeError(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stderr?: string };
  if (e.code === 'ENOENT') return 'docker not found on PATH';
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return 'timed out';
  const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
  if (/cannot connect to the docker daemon|docker desktop is unable/i.test(stderr)) {
    return 'docker daemon not running';
  }
  return stderr.split('\n')[0] || e.message || 'docker ps failed';
}
