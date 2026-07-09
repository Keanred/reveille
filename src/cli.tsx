#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { render } from 'ink';
import { configFile, loadConfig } from './config/load.js';
import { loginGoogle } from './core/google-login.js';
import { createSecretStore } from './core/secrets.js';
import { Dashboard } from './ui/Dashboard.js';
import { runDoctor } from './commands/doctor.js';

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
  const rawArgs = process.argv.slice(2);
  const verbose = rawArgs.includes('--verbose') || rawArgs.includes('-V');
  const args = rawArgs.filter((a) => a !== '--verbose' && a !== '-V');

  if (args[0] === 'login' && args[1] === 'google') {
    await loginGoogleCommand();
    return;
  }

  if (args[0] === 'doctor') {
    process.exitCode = await runDoctor({ verbose });
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
        '  doctor           Check config and credentials',
        '',
        'Options:',
        '  -h, --help       Show this help',
        '  -v, --version    Print version',
        '  --verbose        Print full stack traces on error',
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
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-V');
  const e = err as Error;
  process.stderr.write(`reveille: ${verbose && e.stack ? e.stack : e.message}\n`);
  process.exitCode = 1;
});
