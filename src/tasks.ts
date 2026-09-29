// Pure logic: no `obsidian` import, so tests/ can run it under plain Node.

export interface ParseOptions {
  /** Checkbox characters that mean "finished". Anything else is unfinished. */
  doneMarkers: string;
  /** A task takes its nested lines with it. */
  withChildren: boolean;
  /** Leave out tasks with no text. */
  skipEmpty: boolean;
  /** Only look under these headings ("## Tasks"). Empty means the whole note. */
  headings: string[];
}

export interface Task {
  /** First line, and one past the last line, of the task and what goes with it. */
  start: number;
  end: number;
  /** The lines as written. */
  lines: string[];
  /** The task's text, lowercased, without the checkbox: what two tasks are compared by. */
  key: string;
}

export interface Target {
  /** Put the tasks at the end of this section. Missing or blank: the end of the note. */
  heading: string;
}

export function splitLines(text: string): { lines: string[]; eol: string } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return { lines: text.split(/\r\n|\n/), eol };
}

/** One entry per user-visible character, so an emoji is one marker. */
export function graphemes(s: string): string[] {
  const Segmenter = (Intl as { Segmenter?: new (locale?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) return Array.from(new Segmenter('en', { granularity: 'grapheme' }).segment(s), (x) => x.segment);
  return Array.from(s);
}

const TASK = /^(\s*)([-*+]|\d+[.)])[ \t]+\[([^\]]+)\](?:[ \t]+(.*))?$/;

export interface ParsedTask {
  indent: string;
  marker: string;
  text: string;
}

/** The pieces of a task line, or null for anything else. The marker is a single character. */
export function parseTaskLine(line: string): ParsedTask | null {
  const m = TASK.exec(line);
  if (!m) return null;
  const marker = m[3];
  if (graphemes(marker).length !== 1 || /[\u200B-\u200D\u202E]/.test(marker)) return null;
  return { indent: m[1], marker, text: (m[4] ?? '').trim() };
}

/** The text a task is compared by: no checkbox, lowercase, single spaces. */
export function taskKey(line: string): string {
  const t = parseTaskLine(line);
  return (t ? t.text : line).toLowerCase().replace(/\s+/g, ' ').trim();
}

function width(line: string): number {
  let w = 0;
  for (const ch of line) {
    if (ch === ' ') w++;
    else if (ch === '\t') w += 4;
    else break;
  }
  return w;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

/** Which lines sit inside a fenced code block, fences included. */
function fenced(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let fence: string | null = null;
  let length = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE.exec(lines[i]);
    if (fence === null) {
      if (m) {
        fence = m[1][0];
        length = m[1].length;
        mask[i] = true;
      }
    } else {
      mask[i] = true;
      if (m && m[1][0] === fence && m[1].length >= length && m[2].trim() === '') fence = null;
    }
  }
  return mask;
}

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;

function headingLevel(line: string): number {
  const m = HEADING.exec(line);
  return m ? m[1].length : 0;
}

function sameHeading(line: string, wanted: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const m = HEADING.exec(line);
  if (!m) return false;
  const w = HEADING.exec(wanted.trim());
  // "## Tasks" must match level and text; a bare "Tasks" matches the text at any level.
  return w ? m[1].length === w[1].length && norm(m[2]) === norm(w[2]) : norm(m[2]) === norm(wanted);
}

/** Where the section under `heading` starts and ends (lines), or null. */
export function findSection(lines: string[], heading: string, mask = fenced(lines)): { heading: number; end: number } | null {
  for (let i = 0; i < lines.length; i++) {
    if (mask[i] || !sameHeading(lines[i], heading)) continue;
    const level = headingLevel(lines[i]);
    let end = i + 1;
    while (end < lines.length && (mask[end] || headingLevel(lines[end]) === 0 || headingLevel(lines[end]) > level)) end++;
    return { heading: i, end };
  }
  return null;
}

export function findTasks(lines: string[], options: ParseOptions): Task[] {
  const mask = fenced(lines);
  const done = graphemes(options.doneMarkers);
  const allowed = new Array<boolean>(lines.length).fill(options.headings.length === 0);
  for (const h of options.headings) {
    const s = findSection(lines, h, mask);
    if (s) for (let i = s.heading + 1; i < s.end; i++) allowed[i] = true;
  }

  const tasks: Task[] = [];
  for (let i = 0; i < lines.length; ) {
    const t = mask[i] || !allowed[i] ? null : parseTaskLine(lines[i]);
    if (!t || done.includes(t.marker) || (options.skipEmpty && t.text === '')) {
      i++;
      continue;
    }
    let end = i + 1;
    if (options.withChildren) {
      const own = width(lines[i]);
      while (end < lines.length && !mask[end] && lines[end].trim() !== '' && width(lines[end]) > own) end++;
    }
    tasks.push({ start: i, end, lines: lines.slice(i, end), key: taskKey(lines[i]) });
    i = end;
  }
  return tasks;
}

/** Take the first line's indentation off every line of the block, so a nested task lands at the top level. */
export function dedent(block: string[]): string[] {
  const k = block[0].length - block[0].replace(/^\s+/, '').length;
  return block.map((line) => {
    let n = 0;
    while (n < k && n < line.length && (line[n] === ' ' || line[n] === '\t')) n++;
    return line.slice(n);
  });
}

/** Tasks of `candidates` that are not already in `existing` (any checkbox line) or repeated in the batch. */
export function withoutDuplicates(candidates: Task[], existing: string[], skip: boolean): Task[] {
  if (!skip) return candidates;
  const seen = new Set(existing.filter((l) => parseTaskLine(l)).map(taskKey));
  return candidates.filter((t) => {
    if (seen.has(t.key)) return false;
    seen.add(t.key);
    return true;
  });
}

/** Put the task blocks at the end of the section, or at the end of the note. Returns the new text. */
export function insertTasks(text: string, blocks: string[][], target: Target): string {
  if (blocks.length === 0) return text;
  const { lines, eol } = splitLines(text);
  const added: string[] = [];
  for (const b of blocks) added.push(...dedent(b));
  const heading = target.heading.trim();

  // Where the section's content ends: after its last line that is not blank.
  const at = (from: number, end: number) => {
    let i = end;
    while (i > from && lines[i - 1].trim() === '') i--;
    return i;
  };

  if (heading) {
    const mask = fenced(lines);
    const s = findSection(lines, heading, mask);
    if (s) {
      const pos = at(s.heading + 1, s.end);
      lines.splice(pos, 0, ...added);
      return lines.join(eol);
    }
    // Missing heading: make it, so the tasks are not lost among the rest.
    const level = HEADING.exec(heading) ? heading : `## ${heading}`;
    return appendLines(lines, [level, ...added], eol, true);
  }
  return appendLines(lines, added, eol, false);
}

function appendLines(lines: string[], added: string[], eol: string, blankBefore: boolean): string {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  const head = lines.slice(0, end);
  const lastIsList = end > 0 && /^\s*([-*+]|\d+[.)])\s/.test(head[end - 1]);
  const gap = end > 0 && (blankBefore || !lastIsList) ? [''] : [];
  const trailing = lines.length > 0 && lines[lines.length - 1] === '' ? [''] : [];
  return [...head, ...gap, ...added, ...trailing].join(eol);
}

export type SourceAction = 'keep' | 'remove' | 'mark';

/**
 * Change the earlier note after its tasks moved: take them out, or set their checkbox to the "moved" marker.
 * Only tasks that are still there, unchanged, are touched, so an edit made meanwhile is never lost.
 */
export function applyToSource(
  text: string,
  moved: string[][],
  action: SourceAction,
  marker: string,
  options: ParseOptions,
): { text: string; changed: number } {
  if (action === 'keep' || moved.length === 0) return { text, changed: 0 };
  const { lines, eol } = splitLines(text);
  const pending = moved.map((b) => b.join('\n'));
  const hits: Task[] = [];
  for (const t of findTasks(lines, options)) {
    const i = pending.indexOf(t.lines.join('\n'));
    if (i === -1) continue;
    pending.splice(i, 1);
    hits.push(t);
  }
  if (hits.length === 0) return { text, changed: 0 };
  for (const t of hits.reverse()) {
    if (action === 'remove') lines.splice(t.start, t.end - t.start);
    else lines[t.start] = lines[t.start].replace(/^(\s*(?:[-*+]|\d+[.)])[ \t]+\[)[^\]]+(\])/, `$1${marker}$2`);
  }
  return { text: lines.join(eol), changed: hits.length };
}

/** The most recent day strictly before `target`, from files with a parsed day (ms at the start of that day). */
export function pickEarlier<T extends { day: number }>(files: T[], target: number): T | undefined {
  let best: T | undefined;
  for (const f of files) if (f.day < target && (!best || f.day > best.day)) best = f;
  return best;
}

/** The most recent days before `target`, newest first. */
export function earlierNotes<T extends { day: number }>(files: T[], target: number, limit = 100): T[] {
  return files
    .filter((f) => f.day < target)
    .sort((a, b) => b.day - a.day)
    .slice(0, limit);
}

/** What Rollover Daily Todos keeps in its data.json. */
export interface LegacySettings {
  templateHeading?: unknown;
  deleteOnComplete?: unknown;
  removeEmptyTodos?: unknown;
  rolloverChildren?: unknown;
  rolloverOnFileCreate?: unknown;
  doneStatusMarkers?: unknown;
}

export interface Converted {
  targetHeading?: string;
  sourceAction?: SourceAction;
  skipEmpty?: boolean;
  withChildren?: boolean;
  rolloverOnCreate?: boolean;
  doneMarkers?: string;
}

/** The settings of the original, in ours. Anything missing or of the wrong type is left out. */
export function fromLegacy(legacy: LegacySettings): Converted {
  const out: Converted = {};
  if (typeof legacy.templateHeading === 'string') out.targetHeading = legacy.templateHeading === 'none' ? '' : legacy.templateHeading;
  if (typeof legacy.deleteOnComplete === 'boolean') out.sourceAction = legacy.deleteOnComplete ? 'remove' : 'keep';
  if (typeof legacy.removeEmptyTodos === 'boolean') out.skipEmpty = legacy.removeEmptyTodos;
  if (typeof legacy.rolloverChildren === 'boolean') out.withChildren = legacy.rolloverChildren;
  if (typeof legacy.rolloverOnFileCreate === 'boolean') out.rolloverOnCreate = legacy.rolloverOnFileCreate;
  if (typeof legacy.doneStatusMarkers === 'string' && legacy.doneStatusMarkers.length > 0) out.doneMarkers = legacy.doneStatusMarkers;
  return out;
}
