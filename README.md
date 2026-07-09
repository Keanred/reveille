# reveille

A terminal dashboard that **reveilles** live data sources into one Ink-rendered view.
Cold start paints last-known data instantly from disk cache, then refreshes each
source on its own cadence — every request abortable and timeout-bounded.

> Project name: `reveille`.

## Stack

| Concern     | Choice                                         |
| ----------- | ---------------------------------------------- |
| Language    | TypeScript (end-to-end, ESM)                   |
| Renderer    | Ink (React for the terminal)                   |
| Runtime     | Node 20.6+ (native `fetch`, `import.meta`)     |
| Layout      | Ink flexbox (Yoga)                             |
| HTTP        | Native `fetch` + `AbortSignal.any/timeout`     |
| Config      | TOML via `@iarna/toml`                         |
| Cache       | JSON on disk under `~/.config/reveille/cache/` |
| Secrets     | OS keychain via `keytar`, env-var fallback     |
| Test        | vitest                                         |
| Lint/format | eslint + prettier                              |

These are the defaults chosen from the spec's "pick one" rows (Node over Bun,
TOML over YAML, eslint+prettier over biome). Swap them per the notes below.

## Quick start

```bash
npm install          # installs deps (keytar is optional; failure is non-fatal)
cp config.example.toml ~/.config/reveille/config.toml
npm run dev          # run from source with tsx
```

Build & run the compiled binary:

```bash
npm run build        # tsc -> dist/
npm start            # node dist/cli.js
npm link             # then: reveille   (exercises the package.json bin field)
```

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
  cli.tsx              # bin entry: parse args, load config, render <App>
  app.tsx              # Ink root: config -> sources -> dashboard, quit keys
  paths.ts             # XDG config/cache locations
  config/
    schema.ts          # typed config shape
    index.ts           # TOML load + hand-rolled validation
  http/fetch.ts        # fetch with timeout/abort (fetchJson, HttpError)
  cache/cache.ts       # atomic JSON disk cache (DiskCache)
  secrets/secrets.ts   # keychain-first secret store, env fallback
  sources/
    source.ts          # the Source<T> contract + SourceState types
    clock.ts           # reference Source (local time)
    http-json.ts       # fetch-arbitrary-JSON Source
    registry.ts        # config entry -> live Source (add types here)
  ui/
    hooks/useSource.ts # hydrate-from-cache + refresh loop, per source
    components/         # Dashboard, SourcePanel
test/                  # vitest suite (cache, config, sources, http)
config.example.toml    # documented sample config
```

## The Source contract

`src/sources/source.ts` is the core type. A `Source<T>` is a pure, abortable,
typed data feed:

```ts
interface Source<T> {
  readonly id: string; // stable; also the cache key
  readonly title: string;
  readonly refreshIntervalMs?: number;
  load(ctx: SourceContext): Promise<T>; // must honor ctx.signal
}
```

Rendering is deliberately kept out of the contract so sources stay trivially
testable. Add a new source by: defining its config variant in `config/schema.ts`,
writing a `fooSource(cfg): Source<T>`, and wiring it into `registry.ts`'s switch
(the `never` guard there will flag a missing case at compile time).

## Secrets

Referenced by name from config (`secret = "github-token"`). Resolution order:

1. OS keychain via `keytar`, service `reveille`.
2. Env var `REVEILLE_SECRET_GITHUB_TOKEN` (uppercased, non-alphanumerics → `_`).

`keytar` is an **optional** native dependency; if it fails to install/load,
reveille degrades to env vars rather than crashing.

## Swapping the "pick one" choices

- **Bun instead of Node:** `bun run src/cli.tsx`; replace `tsx`/`tsc` scripts with
  `bun build`. Native `fetch`/keychain differ — re-check `secrets.ts`.
- **YAML instead of TOML:** swap `@iarna/toml` for `yaml` and the parse call in
  `config/index.ts`; the validator is format-agnostic.
- **biome instead of eslint+prettier:** drop the eslint/prettier devDeps + configs,
  add `@biomejs/biome`, and replace the `lint`/`format` scripts.
