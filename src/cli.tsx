#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { render } from 'ink';
import { configFile, loadConfig } from './config/load.js';
import { Dashboard } from './ui/Dashboard.js';

async function readVersion(): Promise<string> {
  const pkgUrl = new URL('../package.json', import.meta.url);
  const pkg = JSON.parse(await readFile(fileURLToPath(pkgUrl), 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      [
        'reveille — a terminal dashboard for live data sources',
        '',
        'Usage: reveille [options]',
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
