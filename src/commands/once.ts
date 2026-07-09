import { cacheDir, configExists, configFile, loadConfig } from '../config/load.js';
import { DiskCache } from '../core/cache.js';
import { runAll } from '../core/orchestrator.js';
import { createSecretStore } from '../core/secrets.js';
import { formatSummary } from '../core/summary.js';
import { buildSources } from '../sources/registry.js';

/**
 * Fetch every source once and print a single compact summary line, then exit.
 * Intended for piping into a shell prompt — colours strip automatically when the
 * output is not a TTY. Never blocks on the first-run scaffold prompt.
 */
export async function runOnce(): Promise<number> {
  if (!(await configExists())) {
    process.stderr.write(`reveille: config not found at ${configFile()} (run 'reveille init')\n`);
    return 1;
  }

  const config = await loadConfig();
  const sources = buildSources(config);
  const cache = new DiskCache(cacheDir());
  const secrets = createSecretStore();

  const results = await runAll(sources, { cache, secrets });
  const states = new Map(sources.map((s, i) => [s.id, results[i]!]));

  const line = formatSummary(sources, states, Date.now());
  if (line) process.stdout.write(`${line}\n`);
  return 0;
}
