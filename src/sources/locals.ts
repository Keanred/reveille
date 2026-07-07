import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { LocalsSourceConfig } from '../config/schema.js';
import type { Source } from '../core/source.js';

const execFileAsync = promisify(execFile);

export interface DiskInfo {
  path: string;
  usedPct: number;
  freeBytes: number;
  totalBytes: number;
  error: string | null;
}

export interface BatteryInfo {
  pct: number;
  state: string;
  time: string | null;
}

export interface LocalsData {
  disks: DiskInfo[];
  battery: BatteryInfo | null;
}

export function localsSource(cfg: LocalsSourceConfig): Source<LocalsData> {
  const paths = cfg.disks
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const mounts = paths.length ? paths : ['/'];

  return {
    id: cfg.id,
    kind: 'locals',
    label: cfg.title ?? 'Locals',
    ttl: (cfg.refresh ?? 60) * 1000,
    timeout: 5_000,
    async fetch(ctx) {
      const [disks, battery] = await Promise.all([
        Promise.all(mounts.map(readDisk)),
        cfg.battery ? readBattery(ctx.signal) : Promise.resolve(null),
      ]);
      return { disks, battery };
    },
  };
}

async function readDisk(path: string): Promise<DiskInfo> {
  try {
    const s = await statfs(path);
    // df capacity is used / (used + avail), not used / total.
    const used = (s.blocks - s.bfree) * s.bsize;
    const freeBytes = s.bavail * s.bsize;
    const totalBytes = s.blocks * s.bsize;
    const usedPct = used + freeBytes > 0 ? Math.round((used / (used + freeBytes)) * 100) : 0;
    return { path, usedPct, freeBytes, totalBytes, error: null };
  } catch (err) {
    return { path, usedPct: 0, freeBytes: 0, totalBytes: 0, error: describeError(err) };
  }
}

async function readBattery(signal: AbortSignal): Promise<BatteryInfo | null> {
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await execFileAsync('pmset', ['-g', 'batt'], { signal });
    const pct = /(\d+)%/.exec(stdout);
    if (!pct) return null;
    const state = /\d+%;\s*([^;]+)/.exec(stdout);
    const time = /(\d+:\d+)\s+remaining/.exec(stdout);
    return {
      pct: Number(pct[1]),
      state: (state?.[1] ?? 'unknown').trim(),
      time: time?.[1] ?? null,
    };
  } catch {
    return null;
  }
}

function describeError(err: unknown): string {
  const e = err as NodeJS.ErrnoException;
  if (e.code === 'ENOENT') return 'no such path';
  if (e.code === 'EACCES') return 'permission denied';
  return e.message || 'statfs failed';
}
