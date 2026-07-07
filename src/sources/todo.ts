import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { TodoSourceConfig } from '../config/schema.js';
import type { Source } from '../core/source.js';

export interface TodoData {
  TodoItem: TodoItem[];
}

export interface TodoItem {
  text: string;
  done: boolean;
}

/**
 * Reads a markdown file and surfaces the checklist under a single heading — "today
 * only", by construction. Only items beneath the configured `section` heading (and
 * above the next heading of the same-or-higher level) are read, so a `## Backlog`
 * further down the file is physically never seen.
 */
export function todoSource(cfg: TodoSourceConfig): Source<TodoData> {
  return {
    id: cfg.id,
    kind: 'todo',
    label: cfg.title ?? cfg.section,
    ttl: (cfg.refresh ?? 30) * 1000,
    timeout: 5_000,
    async fetch(ctx) {
      const text = await readFile(expandPath(cfg.path), { encoding: 'utf8', signal: ctx.signal });
      return { TodoItem: parseSection(text, cfg.section) };
    },
  };
}

/** Matches an ATX heading line, capturing its level (`#` count) and title. */
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
/** Matches a GFM task-list item, capturing the checkbox mark and the label. */
const TASK = /^\s*[-*+]\s+\[([ xX])\]\s+(.*\S)\s*$/;

/**
 * Extracts task-list items under the first heading whose text matches `section`
 * (case-insensitive). Collection stops at the next heading of the same or higher
 * level, so nested subsections stay in but sibling sections (a backlog) stay out.
 * A missing section yields no items rather than an error — an empty "today" is a
 * valid, calming state.
 */
function parseSection(markdown: string, section: string): TodoItem[] {
  const want = section.trim().toLowerCase();
  const items: TodoItem[] = [];
  let level: number | null = null; // set once we're inside the target section

  for (const line of markdown.split('\n')) {
    const heading = HEADING.exec(line);
    if (heading) {
      const depth = (heading[1] ?? '').length;
      if (level == null) {
        if ((heading[2] ?? '').trim().toLowerCase() === want) level = depth;
      } else if (depth <= level) {
        break; // next sibling/parent heading — end of the section
      }
      continue;
    }
    if (level == null) continue;
    const task = TASK.exec(line);
    if (task) items.push({ text: task[2] ?? '', done: task[1] !== ' ' });
  }

  return items;
}

/** Expands a leading `~` and `$VAR`/`${VAR}` references to an absolute path. */
function expandPath(p: string): string {
  const home = p.startsWith('~') ? homedir() + p.slice(1) : p;
  return home.replace(/\$\{?(\w+)\}?/g, (_, name) => process.env[name] ?? '');
}
