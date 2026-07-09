import { configFile, loadConfig, ConfigError } from '../config/load.js';
import type { SourceConfig } from '../config/schema.js';
import { friendlyError } from '../core/errors.js';
import { createSecretStore, keytarAvailable, resolveSecret } from '../core/secrets.js';

function line(text: string): void {
  process.stdout.write(`${text}\n`);
}

/** Secret references a source needs, so we can check they resolve without fetching. */
function sourceSecrets(cfg: SourceConfig): { label: string; ref: string }[] {
  switch (cfg.type) {
    case 'github':
      return [{ label: 'github token', ref: cfg.secret }];
    case 'weather':
      return cfg.secret ? [{ label: 'weather appid', ref: cfg.secret }] : [];
    case 'http-json':
      return cfg.secret ? [{ label: 'auth secret', ref: cfg.secret }] : [];
    case 'google-calendar':
      return [
        { label: 'client id', ref: cfg.clientId },
        { label: 'client secret', ref: cfg.clientSecret },
        { label: 'refresh token', ref: cfg.refreshToken },
      ];
    default:
      return [];
  }
}

export async function runDoctor(opts: { verbose: boolean }): Promise<number> {
  let failures = 0;

  line(`config: ${configFile()}`);

  let config;
  try {
    config = await loadConfig();
    line(`✓ config valid — ${config.sources.length} source(s) configured`);
  } catch (err) {
    if (err instanceof ConfigError) {
      line(`✗ config invalid — ${err.message}`);
    } else {
      line(`✗ could not read config — ${friendlyError(err)}`);
    }
    if (opts.verbose && err instanceof Error && err.stack) line(err.stack);
    return 1;
  }

  if (await keytarAvailable()) {
    line('✓ OS keychain available');
  } else {
    line('⚠ keychain unavailable — using REVEILLE_SECRET_* env vars');
  }

  if (config.sources.length === 0) return failures > 0 ? 1 : 0;

  line('');
  line('credentials:');
  const store = createSecretStore();
  for (const source of config.sources) {
    const secrets = sourceSecrets(source);
    if (secrets.length === 0) {
      line(`✓ ${source.id}: no credentials required`);
      continue;
    }
    for (const { label, ref } of secrets) {
      try {
        await resolveSecret(ref, store);
        line(`✓ ${source.id}: ${label}`);
      } catch (err) {
        failures += 1;
        line(`✗ ${source.id}: ${label} — ${friendlyError(err)}`);
        if (opts.verbose && err instanceof Error && err.stack) line(err.stack);
      }
    }
  }

  return failures > 0 ? 1 : 0;
}
