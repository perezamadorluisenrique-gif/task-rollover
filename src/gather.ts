// Pure logic for gathering unfinished tasks from many past daily notes at once.

import { findTasks, insertTasks, parseTaskLine, splitLines, taskKey } from './tasks.ts';
import type { ParseOptions, Target, Task } from './tasks.ts';

/** A past daily note: where it is, which day it is the note of (ms at the start of that day) and its text. */
export interface SourceNote {
  id: string;
  day: number;
  text: string;
}

export interface Group {
  id: string;
  day: number;
  tasks: Task[];
}

/**
 * The day a file is the daily note of, or null if it is not one. `parse` turns a file name into the start
 * of its day (or null), so this stays free of any date library.
 */
export function dayOfPath(path: string, folder: string, parse: (name: string) => number | null): number | null {
  const prefix = folder ? `${folder}/` : '';
  if (!path.startsWith(prefix)) return null;
  return parse(path.slice(prefix.length).replace(/\.md$/, ''));
}

/** Days strictly before `today` and, when there is a cutoff, not before it. `cutoff` null means no limit. */
export function inRange(day: number, today: number, cutoff: number | null): boolean {
  return day < today && (cutoff === null || day >= cutoff);
}

/**
 * The unfinished tasks of many notes, newest note first, ready to preview. A task whose text is already a
 * checkbox in `existing` (today's note) is left out, and so is a copy of a task that a newer note already
 * has: the newest one is kept. With `skipDuplicates` off, nothing is compared.
 */
export function collectAcross(sources: SourceNote[], options: ParseOptions, existing: string[], skipDuplicates: boolean): Group[] {
  const seen = new Set<string>(skipDuplicates ? existing.filter((l) => parseTaskLine(l)).map(taskKey) : []);
  const groups: Group[] = [];
  for (const s of [...sources].sort((a, b) => b.day - a.day)) {
    const tasks = findTasks(splitLines(s.text).lines, options).filter((t) => {
      if (!skipDuplicates) return true;
      if (seen.has(t.key)) return false;
      seen.add(t.key);
      return true;
    });
    if (tasks.length > 0) groups.push({ id: s.id, day: s.day, tasks });
  }
  return groups;
}

/**
 * Put the chosen tasks into the target note's text. The text is checked again here, so a task that arrived in
 * the note since the preview is not added twice. `taken` says, per source, which tasks went in, in order.
 */
export function insertGathered(
  text: string,
  picks: { id: string; tasks: Task[] }[],
  target: Target,
  skipDuplicates: boolean,
): { text: string; taken: Map<string, Task[]> } {
  const seen = new Set<string>(skipDuplicates ? splitLines(text).lines.filter((l) => parseTaskLine(l)).map(taskKey) : []);
  const taken = new Map<string, Task[]>();
  const blocks: string[][] = [];
  for (const p of picks) {
    for (const t of p.tasks) {
      if (skipDuplicates) {
        if (seen.has(t.key)) continue;
        seen.add(t.key);
      }
      blocks.push(t.lines);
      taken.set(p.id, [...(taken.get(p.id) ?? []), t]);
    }
  }
  return { text: insertTasks(text, blocks, target), taken };
}
