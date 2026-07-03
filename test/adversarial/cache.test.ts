import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiskCache, MemoryCache } from '../../src/core/cache.js';

describe('DiskCache', () => {
  let dir: string;
  let cache: DiskCache;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'reveille-cache-'));
    cache = new DiskCache(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null for a missing key', async () => {
    expect(await cache.get('nope')).toBeNull();
  });

  it('round-trips data and stamps savedAt', async () => {
    await cache.set('greeting', { hello: 'world' });
    const entry = await cache.get<{ hello: string }>('greeting');
    expect(entry?.data).toEqual({ hello: 'world' });
    expect(() => new Date(entry!.savedAt).toISOString()).not.toThrow();
  });

  it('overwrites a previous value', async () => {
    await cache.set('k', 1);
    await cache.set('k', 2);
    const entry = await cache.get<number>('k');
    expect(entry?.data).toBe(2);
  });

  it('sanitizes keys with path separators', async () => {
    await cache.set('a/b/../c', 'safe');
    const entry = await cache.get<string>('a/b/../c');
    expect(entry?.data).toBe('safe');
  });
});

describe('MemoryCache', () => {
  it('round-trips data and reports a miss as null', async () => {
    const cache = new MemoryCache();
    expect(await cache.get('absent')).toBeNull();
    await cache.set('k', { n: 1 });
    expect((await cache.get<{ n: number }>('k'))?.data).toEqual({ n: 1 });
  });
});
