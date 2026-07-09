import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scaffoldConfig } from '../../src/commands/init.js';
import { configExists } from '../../src/config/load.js';

describe('scaffoldConfig', () => {
  let dir: string;
  let configPath: string;
  const prevConfig = process.env.REVEILLE_CONFIG;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reveille-init-'));
    // Point at a nested path so we also exercise directory creation.
    configPath = join(dir, 'nested', 'config.toml');
    process.env.REVEILLE_CONFIG = configPath;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (prevConfig === undefined) delete process.env.REVEILLE_CONFIG;
    else process.env.REVEILLE_CONFIG = prevConfig;
  });

  it('creates the config file (and its directory) from the example', async () => {
    expect(await configExists()).toBe(false);
    const dest = await scaffoldConfig();
    expect(dest).toBe(configPath);
    expect(existsSync(configPath)).toBe(true);
    expect(readFileSync(configPath, 'utf8')).toContain('[app]');
    expect(await configExists()).toBe(true);
  });

  it('refuses to overwrite an existing config without force', async () => {
    await scaffoldConfig();
    await expect(scaffoldConfig()).rejects.toThrow(/already exists/);
  });

  it('overwrites an existing config when force is set', async () => {
    await scaffoldConfig();
    await expect(scaffoldConfig({ force: true })).resolves.toBe(configPath);
  });
});
