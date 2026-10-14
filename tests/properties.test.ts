/**
 * Properties of a rollover between any two notes: rolling the same tasks
 * twice adds nothing, every task moved arrives unfinished and nothing in the
 * target is lost, and the source keeps exactly the tasks that did not move,
 * whether they are removed or marked. Tasks in code or comments never move.
 * Notes are generated from task lines and the pieces in `markdown-samples.ts`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { applyToSource, findTasks, insertTasks, splitLines, withoutDuplicates } from '../src/tasks.ts';
import type { ParseOptions } from '../src/tasks.ts';
import { pick, randomNote, rng } from './markdown-samples.ts';

const LINES = [
  '- [ ] buy milk', '- [x] done', '  - [ ] nested child', '\t- [ ] tab child', '    continuation text', '- [/] in progress',
  '- [ ]', '- [ ] ', '* [ ] star', '1. [ ] numbered', '> - [ ] quoted task', '- [ ] Buy  MILK', '- [ ] 😀 emoji',
  '## Tasks', '# Notes', '```', '> ```', '%%', '<!--', '-->', '', 'text', '- plain item', '- [-] cancelled',
];

function note(seed: number): string {
  const random = rng(seed);
  const lines = Array.from({ length: 1 + Math.floor(random() * 14) }, (_, i) =>
    random() < 0.6 ? pick(random, LINES) : randomNote(seed * 31 + i, 1).replace(/\r/g, ''),
  );
  return lines.join(random() < 0.15 ? '\r\n' : '\n');
}

const OPTIONS: ParseOptions[] = [
  { doneMarkers: 'xX-', withChildren: true, skipEmpty: true, headings: [] },
  { doneMarkers: 'xX-', withChildren: false, skipEmpty: false, headings: [] },
  { doneMarkers: 'x', withChildren: true, skipEmpty: true, headings: ['## Tasks'] },
];

const PAIRS = Array.from({ length: 3000 }, (_, i) => ({ source: note(i + 1), target: note(i + 100001), label: `seed ${i + 1}` }));

/** Whether a note leaves a code block or a comment open at its end, which would swallow what is added. */
const leavesOpen = (text: string) => /```|~~~|<!--|%%/.test(text);

test('rolling the same tasks over twice adds nothing the second time', () => {
  for (const options of OPTIONS) {
    for (const { source, target, label } of PAIRS) {
      const tasks = findTasks(splitLines(source).lines, options);
      for (const heading of ['', '## Tasks', 'Inbox']) {
        const once = insertTasks(target, withoutDuplicates(tasks, splitLines(target).lines, true).map((t) => t.lines), { heading });
        const twice = insertTasks(once, withoutDuplicates(tasks, splitLines(once).lines, true).map((t) => t.lines), { heading });
        assert.equal(twice, once, label);
      }
    }
  }
});

test('every task moved arrives unfinished, and the target keeps all it had', () => {
  for (const options of OPTIONS) {
    for (const { source, target, label } of PAIRS) {
      if (leavesOpen(target)) continue;
      const moved = withoutDuplicates(findTasks(splitLines(source).lines, options), splitLines(target).lines, true);
      const out = insertTasks(target, moved.map((t) => t.lines), { heading: '' });
      const keys = new Set(findTasks(splitLines(out).lines, { ...options, headings: [] }).map((t) => t.key));
      for (const t of moved) assert.ok(keys.has(t.key), `${label}: ${t.lines[0]}`);
      // The target's own lines are all still there, in order.
      const kept = splitLines(target).lines.filter((l) => l.trim() !== '');
      let next = 0;
      for (const line of splitLines(out).lines) if (line === kept[next]) next++;
      assert.equal(next, kept.length, label);
      // Line endings follow the target's.
      if (!/(^|[^\r])\n/.test(target + source) && target.includes('\r\n')) assert.doesNotMatch(out, /(^|[^\r])\n/, label);
    }
  }
});

test('the source keeps exactly the tasks that did not move, removed or marked', () => {
  for (const options of OPTIONS) {
    for (const { source, label } of PAIRS) {
      const tasks = findTasks(splitLines(source).lines, options);
      const moved = tasks.filter((_, i) => i % 2 === 0);
      const removed = applyToSource(source, moved.map((t) => t.lines), 'remove', '>', options);
      assert.equal(removed.changed, moved.length, label);
      assert.equal(findTasks(splitLines(removed.text).lines, options).length, tasks.length - moved.length, label);
      const marked = applyToSource(source, moved.map((t) => t.lines), 'mark', '>', options);
      assert.equal(splitLines(marked.text).lines.length, splitLines(source).lines.length, label);
      // A marked task, and the tasks nested in it, never roll over again.
      const left = findTasks(splitLines(marked.text).lines, { ...options, doneMarkers: options.doneMarkers + '>' });
      assert.equal(left.length, tasks.length - moved.length, label);
    }
  }
});

test('a task in code or in a comment is never rolled over', () => {
  const wrappers: [string[], string[]][] = [
    [['```md'], ['```']],
    [['~~~'], ['~~~']],
    [['> [!example]', '> ```md'], ['> ```']],
    [['- item', '\t```'], ['\t```']],
    [['%%'], ['%%']],
    [['<!--'], ['-->']],
    [['%%'], []],
  ];
  for (const { source, label } of PAIRS.slice(0, 1000)) {
    // Only the task lines, so nothing inside closes the wrapper early.
    const inner = splitLines(source).lines.filter((l) => /\[.\]/.test(l));
    for (const [open, close] of wrappers) {
      const lines = ['- [ ] before', ...open, ...inner.map((l) => (open[0].startsWith('>') ? `> ${l}` : open[0] === '- item' ? `\t${l}` : l)), ...close, '- [ ] after'];
      const keys = findTasks(lines, OPTIONS[1]).map((t) => t.key);
      assert.deepEqual(keys, close.length > 0 ? ['before', 'after'] : ['before'], `${label}: ${open.join(' ')}`);
    }
  }
});
