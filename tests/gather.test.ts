import test from 'node:test';
import assert from 'node:assert/strict';

import { collectAcross, dayOfPath, inRange, insertGathered } from '../src/gather.ts';
import type { SourceNote } from '../src/gather.ts';
import { applyToSource } from '../src/tasks.ts';
import type { ParseOptions } from '../src/tasks.ts';

const OPTS: ParseOptions = { doneMarkers: 'xX-', withChildren: true, skipEmpty: true, headings: [] };
const DAY = 86400000;
const note = (id: string, day: number, text: string): SourceNote => ({ id, day, text });
const lines = (g: { tasks: { lines: string[] }[] }) => g.tasks.map((t) => t.lines.join('|'));

const parse = (name: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(name);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
};

test('dayOfPath reads the day from the file name under the folder', () => {
  assert.equal(dayOfPath('Daily/2026-10-01.md', 'Daily', parse), Date.UTC(2026, 9, 1));
  assert.equal(dayOfPath('2026-10-01.md', '', parse), Date.UTC(2026, 9, 1));
  assert.equal(dayOfPath('Other/2026-10-01.md', 'Daily', parse), null);
  assert.equal(dayOfPath('Daily/notes.md', 'Daily', parse), null);
  assert.equal(dayOfPath('Daily/sub/2026-10-01.md', 'Daily', parse), null);
});

test('inRange keeps past days from the cutoff on, and all of them without one', () => {
  const today = 100 * DAY;
  assert.equal(inRange(today, today, null), false, 'today is not past');
  assert.equal(inRange(today + DAY, today, null), false, 'the future is not past');
  assert.equal(inRange(today - DAY, today, today - 7 * DAY), true);
  assert.equal(inRange(today - 7 * DAY, today, today - 7 * DAY), true, 'the cutoff day itself counts');
  assert.equal(inRange(today - 8 * DAY, today, today - 7 * DAY), false);
  assert.equal(inRange(today - 500 * DAY, today, null), true);
});

test('collectAcross lists notes newest first with their unfinished tasks', () => {
  const groups = collectAcross(
    [note('a', 1 * DAY, '- [ ] old'), note('c', 3 * DAY, '- [ ] newest\n  - child\n- [x] done'), note('b', 2 * DAY, '- [ ] middle')],
    OPTS,
    [],
    true,
  );
  assert.deepEqual(groups.map((g) => g.id), ['c', 'b', 'a']);
  assert.deepEqual(lines(groups[0]), ['- [ ] newest|  - child']);
});

test('collectAcross keeps only the newest copy of an identical task', () => {
  const groups = collectAcross(
    [note('old', 1 * DAY, '- [ ] Call Ana\n- [ ] only old'), note('new', 2 * DAY, '- [/] call  ana')],
    OPTS,
    [],
    true,
  );
  assert.deepEqual(groups.map((g) => [g.id, lines(g)]), [
    ['new', ['- [/] call  ana']],
    ['old', ['- [ ] only old']],
  ]);
});

test('collectAcross drops a note whose tasks are all copies, and tasks already in today', () => {
  const groups = collectAcross(
    [note('old', 1 * DAY, '- [ ] same'), note('new', 2 * DAY, '- [ ] same\n- [ ] in today')],
    OPTS,
    ['# Today', '- [x] In today'],
    true,
  );
  assert.deepEqual(groups.map((g) => [g.id, lines(g)]), [['new', ['- [ ] same']]]);
});

test('collectAcross compares nothing when duplicates are allowed', () => {
  const groups = collectAcross([note('old', 1 * DAY, '- [ ] same'), note('new', 2 * DAY, '- [ ] same')], OPTS, ['- [ ] same'], false);
  assert.equal(groups.length, 2);
});

test('collectAcross applies the usual filters: finished markers, headings, empty tasks', () => {
  const text = '## Tasks\n- [ ] keep\n- [-] cancelled\n- [ ]\n## Other\n- [ ] outside';
  const groups = collectAcross([note('a', DAY, text)], { ...OPTS, headings: ['## Tasks'] }, [], true);
  assert.deepEqual(groups.map(lines), [['- [ ] keep']]);
});

test('insertGathered puts the tasks in order under the heading and reports what went in', () => {
  const groups = collectAcross([note('a', 1 * DAY, '- [ ] one\n  - c'), note('b', 2 * DAY, '- [ ] two')], OPTS, [], true);
  const r = insertGathered('# Today\n## Tasks\n\n## Notes\n', groups, { heading: '## Tasks' }, true);
  assert.equal(r.text, '# Today\n## Tasks\n- [ ] two\n- [ ] one\n  - c\n\n## Notes\n');
  assert.deepEqual([...r.taken.keys()], ['b', 'a']);
});

test('insertGathered skips what appeared in the note since the preview, and repeats within the batch', () => {
  const groups = [
    { id: 'a', tasks: collectAcross([note('a', DAY, '- [ ] one\n- [ ] two')], OPTS, [], true)[0].tasks },
    { id: 'b', tasks: collectAcross([note('b', DAY, '- [ ] two\n- [ ] three')], OPTS, [], true)[0].tasks },
  ];
  const r = insertGathered('- [ ] ONE\n', groups, { heading: '' }, true);
  assert.equal(r.text, '- [ ] ONE\n- [ ] two\n- [ ] three\n');
  assert.equal(r.taken.get('a')?.length, 1);
  assert.equal(r.taken.get('b')?.length, 1);
  assert.equal(insertGathered('x', groups, { heading: '' }, true).taken.size, 2);
});

test('insertGathered with nothing picked leaves the text alone', () => {
  const r = insertGathered('# Today', [], { heading: '' }, true);
  assert.equal(r.text, '# Today');
  assert.equal(r.taken.size, 0);
});

test('a gather then the source change touches only the moved tasks, per note', () => {
  const a = '- [ ] one\n  - c\n- [ ] keep';
  const groups = collectAcross([note('a', DAY, a)], OPTS, [], true);
  const picked = groups[0].tasks.filter((t) => t.key === 'one');
  const r = insertGathered('', [{ id: 'a', tasks: picked }], { heading: '' }, true);
  const moved = r.taken.get('a')!.map((t) => t.lines);
  assert.equal(applyToSource(a, moved, 'remove', '>', OPTS).text, '- [ ] keep');
  assert.equal(applyToSource(a, moved, 'mark', '>', OPTS).text, '- [>] one\n  - c\n- [ ] keep');
  assert.equal(applyToSource('- [ ] one edited', moved, 'remove', '>', OPTS).changed, 0, 'an edited line is left alone');
});
