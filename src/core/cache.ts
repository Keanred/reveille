import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface CacheEntry<T> {
  savedAt: string;
  data: T;
}

export interface Cache {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, data: T): Promise<void>;
}

function sanitize(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export class DiskCache implements Cache {
  constructor(private readonly dir: string) {}

  private filePath(key: string): string {
    return path.join(this.dir, `${sanitize(key)}.json`);
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
      const raw = await readFile(this.filePath(key), 'utf8');
      return JSON.parse(raw) as CacheEntry<T>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async set<T>(key: string, data: T): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const entry: CacheEntry<T> = { savedAt: new Date().toISOString(), data };
    const file = this.filePath(key);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(entry, null, 2), 'utf8');
    await rename(tmp, file);
  }
}

export class MemoryCache implements Cache {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    return (this.store.get(key) as CacheEntry<T> | undefined) ?? null;
  }

  async set<T>(key: string, data: T): Promise<void> {
    this.store.set(key, { savedAt: new Date().toISOString(), data });
  }
}
