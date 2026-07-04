import { z } from 'zod';

/** Zod schema + inferred types for the parsed TOML config. */

const baseSource = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  /** Per-source refresh cadence in seconds. */
  refresh: z.number().positive().optional(),
});

export const clockSourceSchema = baseSource.extend({
  type: z.literal('clock'),
});

export const httpJsonSourceSchema = baseSource.extend({
  type: z.literal('http-json'),
  url: z.url(),
  /** Secret reference (env:/cmd:/keychain:/literal) resolved and sent as a Bearer token. */
  secret: z.string().optional(),
});

export const weatherSourceSchema = baseSource.extend({
  type: z.literal('weather'),
  /** OpenWeather 2.5 `/weather` endpoint. The API key may be baked in as `appid`. */
  url: z.url(),
  /** Optional secret resolved and appended as the `appid` query param. */
  secret: z.string().optional(),
});

export const gitSourceSchema = baseSource.extend({
  type: z.literal('git'),
  repos: z.array(z.string().min(1)).min(1),
  fetchRemote: z.boolean().default(false),
  repoTimeout: z.number().positive().default(3),
});

export const githubSourceSchema = baseSource.extend({
  type: z.literal('github'),
  /**
   * Secret reference (env:/cmd:/keychain:/literal) for a Personal Access Token,
   * resolved and sent as a Bearer token. A classic PAT needs `repo` + `notifications`
   * scopes; a fine-grained token needs Pull requests (read) + Notifications (read).
   */
  secret: z.string(),
  /** Which sections to fetch/show. All default on — turn off what you don't want. */
  reviewRequests: z.boolean().default(true), // PRs awaiting your review
  myPrs: z.boolean().default(true), // your open PRs + CI status
  notifications: z.boolean().default(true), // unread notification count
  /**
   * Cap on PRs pulled per section. Bounds the per-PR CI fan-out so a large backlog
   * can't drain the API rate-limit bucket on every refresh.
   */
  maxPrs: z.number().int().positive().default(20),
});

export const googleCalendarSourceSchema = baseSource.extend({
  type: z.literal('google-calendar'),
  /**
   * OAuth client id + secret and the refresh token, each a secret reference
   * (env:/cmd:/keychain:/literal). The refresh token defaults to the keychain
   * entry `reveille login google` writes; the client id/secret typically point at
   * env vars (e.g. `env:GOOGLE_CLIENT_ID`).
   */
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  refreshToken: z.string().default('keychain:google-refresh'),
  /** Which calendar to read. `primary` is the account's default calendar. */
  calendarId: z.string().default('primary'),
  /**
   * IANA timezone that defines "today" and how event times render (e.g.
   * `America/New_York`). Defaults to the machine's zone. Get this right — it's
   * what makes all-day events and DST behave.
   */
  timezone: z.string().optional(),
  /** Max events to pull for today. */
  maxEvents: z.number().int().positive().default(10),
});

export const sourceSchema = z.discriminatedUnion('type', [
  clockSourceSchema,
  httpJsonSourceSchema,
  weatherSourceSchema,
  gitSourceSchema,
  githubSourceSchema,
  googleCalendarSourceSchema,
]);

export const appSchema = z.object({
  /** Fallback refresh cadence (seconds) for sources without their own. */
  refresh: z.number().positive().default(30),
  /**
   * Optional first-paint budget (seconds). Once it elapses, any panel still
   * stuck on `loading` (no cache, slow first fetch) is forced to a terminal
   * state so the board never hangs half-painted. Omit for no budget.
   */
  budget: z.number().positive().optional(),
});

export const configSchema = z
  .object({
    app: appSchema.default({ refresh: 30 }),
    sources: z.array(sourceSchema).default([]),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    cfg.sources.forEach((source, index) => {
      if (seen.has(source.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sources', index, 'id'],
          message: `duplicate source id "${source.id}"`,
        });
      }
      seen.add(source.id);
    });
  });

export type AppConfig = z.infer<typeof appSchema>;
export type ClockSourceConfig = z.infer<typeof clockSourceSchema>;
export type HttpJsonSourceConfig = z.infer<typeof httpJsonSourceSchema>;
export type WeatherSourceConfig = z.infer<typeof weatherSourceSchema>;
export type GitSourceConfig = z.infer<typeof gitSourceSchema>;
export type GithubSourceConfig = z.infer<typeof githubSourceSchema>;
export type GoogleCalendarSourceConfig = z.infer<typeof googleCalendarSourceSchema>;
export type SourceConfig = z.infer<typeof sourceSchema>;
export type SourceType = SourceConfig['type'];
export type ReveilleConfig = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG: ReveilleConfig = configSchema.parse({});
