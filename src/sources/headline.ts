import type { Source } from '../core/source.js';
import type { HeadlineSourceConfig } from '../config/schema.js';

export interface HeadlineData {
  text: string;
  timestamp: string;
}
// Best story from hackernews
export function headlineSource(cfg: HeadlineSourceConfig): Source<HeadlineData> {
    return {
        id: cfg.id,
        kind: 'headline',
        label: cfg.title ?? 'Headline',
        ttl: (cfg.refresh ?? 60) * 1000,
        timeout: 15_000,
        async fetch(ctx) {
            const url = new URL(cfg.feed === 'best' ? 'https://hacker-news.firebaseio.com/v0/beststories.json' : 'https://hacker-news.firebaseio.com/v0/topstories.json');
            const res = await fetch(url, { signal: ctx.signal });
            if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
            const storyIds: number[] = await res.json();
            if (storyIds.length === 0) throw new Error(`No stories found at ${url}`);
            const storyId = storyIds[0];
            const storyUrl = new URL(`https://hacker-news.firebaseio.com/v0/item/${storyId}.json`);
            const storyRes = await fetch(storyUrl, { signal: ctx.signal });
            if (!storyRes.ok) throw new Error(`Failed to fetch ${storyUrl}: ${storyRes.status} ${storyRes.statusText}`);
            const storyData: { title?: string; time?: number } | null = await storyRes.json();
            if (!storyData || !storyData.title) throw new Error(`Story ${storyId} has no title`);
            return {
                text: storyData.title,
                timestamp: storyData.time ? new Date(storyData.time * 1000).toISOString() : '',
            };
        },
    };
}