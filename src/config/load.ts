import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import toml from '@iarna/toml';
import { z } from 'zod';
import { configSchema, DEFAULT_CONFIG, type ReveilleConfig } from './schema.js';

export function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config');
  return path.join(base, 'reveille');
}

export function configFile(): string {
  return process.env.REVEILLE_CONFIG?.trim() || path.join(configDir(), 'config.toml');
}

export function cacheDir(): string {
  return path.join(configDir(), 'cache');
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
      return `${where}${issue.message}`;
    })
    .join('; ');
}

export function validateConfig(input: unknown): ReveilleConfig {
  const result = configSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigError(formatZodError(result.error));
  }
  return result.data;
}

export async function loadConfig(file: string = configFile()): Promise<ReveilleConfig> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_CONFIG;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = toml.parse(raw);
  } catch (err) {
    throw new ConfigError(`Failed to parse ${file}: ${(err as Error).message}`);
  }
  return validateConfig(parsed);
}
