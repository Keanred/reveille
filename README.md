# reveille

A terminal dashboard that **reveilles** live data sources into one Ink-rendered view.
Cold start paints last-known data instantly from the disk cache, then refreshes each
source on its own cadence — every request abortable and timeout-bounded.

> Project name: `reveille`.

## Stack

| Concern     | Choice                                         |
| ----------- | ---------------------------------------------- |
| Language    | TypeScript (end-to-end, ESM)                   |
| Renderer    | Ink (React for the terminal)                   |
| Runtime     | Node 20.12+ (native `fetch`, `--env-file`)     |
| Layout      | Ink flexbox (Yoga), masonry columns            |
| HTTP        | Native `fetch` + `AbortSignal.any/timeout`     |
| Config      | TOML via `@iarna/toml`, validated with Zod     |
| Cache       | JSON on disk under `~/.config/reveille/cache/` |
| Secrets     | OS keychain via `keytar`, env-var fallback     |
| Test        | vitest                                         |
| Lint/format | eslint + prettier                              |

## Quick start

```bash
npm install          # keytar is optional; a failed native build is non-fatal
npm run dev          # run from source with tsx (loads .env if present)
```

On first run with no config, reveille offers to scaffold a starter one at
`~/.config/reveille/config.toml` (or run `reveille init` explicitly). Out of the box
you get a `clock` and a Hacker News panel; edit the config to add more sources — see
[`config.example.toml`](config.example.toml) for every documented option.

Build & run the compiled CLI:

```bash
npm run build        # tsc -> dist/
npm start            # node dist/cli.js (loads .env if present)
npm link             # then: `reveille` anywhere (exercises the package.json bin)
```

Press `q` (or Ctrl-C) to quit the dashboard.

## Commands & flags

| Invocation              | Does                                                 |
| ----------------------- | ---------------------------------------------------- |
| `reveille`              | Launch the interactive dashboard (default)           |
| `reveille init`         | Scaffold a starter config (`--force` to overwrite)   |
| `reveille doctor`       | Validate config and check every source's credentials |
| `reveille login google` | Authorize Google Calendar; stores a refresh token    |
| `--help` / `-h`         | Usage                                                |
| `--version` / `-v`      | Print version                                        |
| `--verbose` / `-V`      | Full stack traces on error                           |

`reveille doctor` is the first thing to run when a panel misbehaves — it reports which
credential failed to resolve and where it was looked for.

## Scripts

| Script               | Does                            |
| -------------------- | ------------------------------- |
| `npm run dev`        | Run the TUI from source (`tsx`) |
| `npm run build`      | Type-check + emit `dist/`       |
| `npm start`          | Run the built CLI               |
| `npm run typecheck`  | `tsc --noEmit`                  |
| `npm test`           | Run the vitest suite once       |
| `npm run test:watch` | Watch mode                      |
| `npm run lint`       | eslint                          |
| `npm run format`     | prettier --write                |

## Layout

```
src/
  cli.tsx              # bin entry: arg dispatch, first-run prompt, Ink render
  commands/
    init.ts            # `reveille init` — scaffold config from config.example.toml
    doctor.ts          # `reveille doctor` — validate config + check credentials
  config/
    schema.ts          # Zod schema for [app], [theme], and every source type
    load.ts            # XDG config/cache paths, TOML load + Zod validation
  core/
    source.ts          # the Source<T> contract + SourceState types
    orchestrator.ts    # fetch/poll engine: runAll, streamAll, scheduleSources
    cache.ts           # atomic JSON disk cache (DiskCache)
    secrets.ts         # keychain-first secret store + keychain:/env:/cmd: refs
    http.ts, timeout.ts# fetch with timeout/abort
    time.ts            # countdown + timezone-aware date helpers
    summary.ts         # pure summary-line builder (shared by the UI and future modes)
    google-*.ts, token.ts  # Google OAuth (login + token refresh)
    errors.ts          # friendlyError — human-readable failure messages
  sources/
    registry.ts        # config entry -> live Source (add new types to the switch)
    clock, weather, git, github, google-calendar, todo,
    docker, locals, daylight, headline, http-json
  ui/
    Dashboard.tsx      # Ink root: masonry panels, summary line, quit keys
    Panel.tsx          # bordered panel (title, status badge, body, footer)
    useDashboard.ts    # data hook: hydrate-from-cache then poll each source
    theme.tsx          # presets (default / nord / gruvbox) + per-role overrides
    panels/            # one body component per source kind + bodyFor()
test/                  # vitest suite
config.example.toml    # documented sample config
```

## The Source contract

`src/core/source.ts` is the core type. A `Source<T>` is a pure, abortable, typed data
feed — rendering is deliberately kept out of it so sources stay trivially testable:

```ts
interface Source<T = unknown> {
  readonly id: string; // stable; also the cache key
  readonly kind: string; // source type; selects the panel renderer
  readonly label: string; // panel title
  readonly ttl: number; // refresh interval, ms
  readonly timeout: number; // per-fetch timeout, ms
  fetch(ctx: SourceContext): Promise<T>; // must honor ctx.signal
}

type SourceState<T> =
  | { status: 'loading' }
  | { status: 'ok'; data: T; fetchedAt: number }
  | { status: 'stale'; data: T; fetchedAt: number; error: Error }
  | { status: 'error'; error: Error };
```

Add a source by: defining its config variant in `config/schema.ts` (extend the
`discriminatedUnion`), writing a `fooSource(cfg): Source<T>`, wiring it into
`registry.ts`'s switch (the `never` guard flags a missing case at compile time), and
adding a panel body under `ui/panels/` registered in `bodyFor()`.

Built-in source types: `clock`, `http-json`, `weather`, `git`, `github`,
`google-calendar`, `todo`, `docker`, `locals`, `daylight`, `headline`.

## Secrets

Any config field that holds a credential accepts a **secret reference**, resolved by
`core/secrets.ts`:

| Ref               | Resolves to                                                                     |
| ----------------- | ------------------------------------------------------------------------------- |
| `keychain:NAME`   | OS keychain (service `reveille`, account `NAME`), then `REVEILLE_SECRET_<NAME>` |
| `env:NAME`        | environment variable `NAME`                                                     |
| `cmd:<command>`   | stdout of a shell command                                                       |
| _(anything else)_ | used as a literal value                                                         |

Prefer `keychain:` for anything the dashboard reads unattended — `env:` only resolves
when the vars are exported (or `npm run dev`/`start` loads `.env`), so an `env:`-based
source silently fails when launched any other way. Store one with:

```bash
security add-generic-password -U -s reveille -a openweather -w 'YOUR_KEY'   # macOS
```

`keytar` is an **optional** native dependency; if it fails to install or load, reveille
degrades to `REVEILLE_SECRET_*` env vars rather than crashing.

## License

MIT — see [LICENSE](LICENSE).
