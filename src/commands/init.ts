import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configExists, configFile } from '../config/load.js';

export async function scaffoldConfig(opts: { force?: boolean } = {}): Promise<string> {
  const dest = configFile();
  if (!opts.force && (await configExists(dest))) {
    throw new Error(`config already exists at ${dest} (use --force to overwrite)`);
  }
  // From src/commands/init.ts (and dist/commands/init.js) the repo root is two levels up.
  const src = fileURLToPath(new URL('../../config.example.toml', import.meta.url));
  const template = await readFile(src, 'utf8');
  await mkdir(dirname(dest), { recursive: true }); // config dir isn't created anywhere today
  await writeFile(dest, template, 'utf8');
  return dest;
}

export async function runInit(opts: { force: boolean }): Promise<number> {
  try {
    const dest = await scaffoldConfig({ force: opts.force });
    process.stdout.write(`✓ created ${dest}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`reveille: ${(err as Error).message}\n`);
    return 1;
  }
}
