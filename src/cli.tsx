#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { render } from 'ink';
import { configFile, loadConfig } from './config/load.js';
import { loginGoogle } from './core/google-login.js';
import { createSecretStore } from './core/secrets.js';
import { Dashboard } from './ui/Dashboard.js';

async function readVersion(): Promise<string> {
  const pkgUrl = new URL('../package.json', import.meta.url);
  const pkg = JSON.parse(await readFile(fileURLToPath(pkgUrl), 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0';
}

async function loginGoogleCommand(): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your environment first ' +
        '(from your Google Cloud OAuth desktop-app client)',
    );
  }
  await loginGoogle({ clientId, clientSecret, secrets: createSecretStore() });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === 'login' && args[1] === 'google') {
    await loginGoogleCommand();
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      [
        'reveille — a terminal dashboard for live data sources',
        '',
        'Usage: reveille [command] [options]',
        '',
        'Commands:',
        '  login google     Authorize Google Calendar (stores a refresh token)',
        '',
        'Options:',
        '  -h, --help       Show this help',
        '  -v, --version    Print version',
        '',
        `Config: ${configFile()}`,
        '',
      ].join('\n'),
    );
    return;
  }

  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`${await readVersion()}\n`);
    return;
  }

  const config = await loadConfig();
  const { waitUntilExit } = render(<Dashboard config={config} />);
  await waitUntilExit();
}

main().catch((err: unknown) => {
  process.stderr.write(`reveille: ${(err as Error).message}\n`);
  process.exitCode = 1;
});
