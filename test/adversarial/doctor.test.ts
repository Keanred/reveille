import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDoctor } from '../../src/commands/doctor.js';

describe('runDoctor', () => {
  let dir: string;
  let configPath: string;
  const prevConfig = process.env.REVEILLE_CONFIG;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reveille-doctor-'));
    configPath = join(dir, 'config.toml');
    process.env.REVEILLE_CONFIG = configPath;
    // Silence the report; we only assert on the exit code.
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
    if (prevConfig === undefined) delete process.env.REVEILLE_CONFIG;
    else process.env.REVEILLE_CONFIG = prevConfig;
  });

  it('returns 0 for a valid config that needs no credentials', async () => {
    writeFileSync(configPath, '[[sources]]\nid = "clock"\ntype = "clock"\n');
    expect(await runDoctor({ verbose: false })).toBe(0);
  });

  it('returns 1 for a malformed config', async () => {
    writeFileSync(configPath, 'this is = not valid [[[\n');
    expect(await runDoctor({ verbose: false })).toBe(1);
  });

  it('returns 1 when a required credential cannot resolve', async () => {
    delete process.env.REVEILLE_DOCTOR_MISSING;
    writeFileSync(
      configPath,
      '[[sources]]\nid = "gh"\ntype = "github"\nsecret = "env:REVEILLE_DOCTOR_MISSING"\n',
    );
    expect(await runDoctor({ verbose: false })).toBe(1);
  });

  it('returns 0 when every credential resolves', async () => {
    process.env.REVEILLE_DOCTOR_TOKEN = 'tok';
    writeFileSync(
      configPath,
      '[[sources]]\nid = "gh"\ntype = "github"\nsecret = "env:REVEILLE_DOCTOR_TOKEN"\n',
    );
    try {
      expect(await runDoctor({ verbose: false })).toBe(0);
    } finally {
      delete process.env.REVEILLE_DOCTOR_TOKEN;
    }
  });
});
