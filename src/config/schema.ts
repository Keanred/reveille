import { z } from 'zod';

const baseSource = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  refresh: z.number().positive().optional(),
});

export const clockSourceSchema = baseSource.extend({
  type: z.literal('clock'),
});

export const httpJsonSourceSchema = baseSource.extend({
  type: z.literal('http-json'),
  url: z.url(),
  secret: z.string().optional(),
});

export const weatherSourceSchema = baseSource.extend({
  type: z.literal('weather'),
  url: z.url(),
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
  secret: z.string(),
  reviewRequests: z.boolean().default(true),
  myPrs: z.boolean().default(true),
  notifications: z.boolean().default(true),
  maxPrs: z.number().int().positive().default(20),
});

export const googleCalendarSourceSchema = baseSource.extend({
  type: z.literal('google-calendar'),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  refreshToken: z.string().default('keychain:google-refresh'),
  calendarId: z.string().default('primary'),
  timezone: z.string().optional(),
  maxEvents: z.number().int().positive().default(10),
});

export const todoSourceSchema = baseSource.extend({
  type: z.literal('todo'),
  path: z.string().min(1),
  section: z.string().default('Today'),
});

export const dockerSourceSchema = baseSource.extend({
  type: z.literal('docker'),
  timeout: z.number().positive().default(5),
});

export const localsSourceSchema = baseSource.extend({
  type: z.literal('locals'),
  disks: z.string(),
  battery: z.boolean().default(true),
  refresh: z.number().positive().default(60),
});

export const daylightSourceSchema = baseSource.extend({
  id: z.string(),
  type: z.literal('daylight'),
  title: z.string().optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  timezone: z.string().optional(),
  refresh: z.number().positive().default(3600),
});

export const headlineSourceSchema = baseSource.extend({
  id: z.string(),
  type: z.literal('headline'),
  title: z.string().optional(),
  feed: z.literal('best').or(z.literal('top')),


})

export const sourceSchema = z.discriminatedUnion('type', [
  clockSourceSchema,
  httpJsonSourceSchema,
  weatherSourceSchema,
  gitSourceSchema,
  githubSourceSchema,
  googleCalendarSourceSchema,
  todoSourceSchema,
  dockerSourceSchema,
  localsSourceSchema,
  daylightSourceSchema,
  headlineSourceSchema,
]);

export const appSchema = z.object({
  refresh: z.number().positive().default(30),
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
export type TodoSourceConfig = z.infer<typeof todoSourceSchema>;
export type DockerSourceConfig = z.infer<typeof dockerSourceSchema>;
export type LocalsSourceConfig = z.infer<typeof localsSourceSchema>;
export type DaylightSourceConfig = z.infer<typeof daylightSourceSchema>;
export type HeadlineSourceConfig = z.infer<typeof headlineSourceSchema>;
export const DEFAULT_CONFIG: ReveilleConfig = configSchema.parse({});
