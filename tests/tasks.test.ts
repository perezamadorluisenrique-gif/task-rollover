import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyToSource,
  dedent,
  earlierNotes,
  findSection,
  findTasks,
  fromLegacy,
  insertTasks,
  parseTaskLine,
  pickEarlier,
  splitLines,
  taskKey,
  withoutDuplicates,
} from '../src/tasks.ts';
import type { ParseOptions } from '../src/tasks.ts';

const OPTS: ParseOptions = { doneMarkers: 'xX->', withChildren: true, skipEmpty: true, headings: [] };
const lines = (s: string) => s.split('\n');
const found = (s: string, o: Partial<ParseOptions> = {}) => findTasks(lines(s), { ...OPTS, ...o }).map((t) => t.lines.join('|'));

test('parses task lines of every bullet and ordered lists', () => {
  assert.deepEqual(parseTaskLine('- [ ] buy milk'), { indent: '', marker: ' ', text: 'buy milk' });
  assert.deepEqual(parseTaskLine('\t* [/] half done'), { indent: '\t', marker: '/', text: 'half done' });
  assert.deepEqual(parseTaskLine('1. [ ] first'), { indent: '', marker: ' ', text: 'first' });
  assert.deepEqual(parseTaskLine('2) [x] second'), { indent: '', marker: 'x', text: 'second' });
  assert.deepEqual(parseTaskLine('- [🔥] hot'), { indent: '', marker: '🔥', text: 'hot' });
  assert.equal(parseTaskLine('- [ ]')?.text, '');
});

test('lines that are not tasks are not parsed', () => {
  for (const l of ['- plain', '[ ] no bullet', '-[ ] no space', '- [] empty box', '- [ab] two chars', '- [[link]] wiki', 'text - [ ] inside']) {
    assert.equal(parseTaskLine(l), null, l);
  }
});

test('finds unfinished tasks, not finished ones', () => {
  const note = '- [ ] a\n- [x] b\n- [X] c\n- [-] d\n- [>] e\n- [/] f\n- [ ] g';
  assert.deepEqual(found(note), ['- [ ] a', '- [/] f', '- [ ] g']);
});

test('done markers are a setting, and can be an emoji', () => {
  assert.deepEqual(found('- [ ] a\n- [?] b\n- [🎉] c', { doneMarkers: '?🎉' }), ['- [ ] a']);
});

test('empty tasks are skipped on request', () => {
  assert.deepEqual(found('- [ ]\n- [ ]   \n- [ ] real'), ['- [ ] real']);
  assert.deepEqual(found('- [ ]\n- [ ] real', { skipEmpty: false }), ['- [ ]', '- [ ] real']);
});

test('a task takes its nested lines when asked', () => {
  const note = '- [ ] parent\n  - child\n  - [x] done child\n    - deep\n- [ ] next';
  assert.deepEqual(found(note), ['- [ ] parent|  - child|  - [x] done child|    - deep', '- [ ] next']);
  assert.deepEqual(found(note, { withChildren: false }), ['- [ ] parent', '- [ ] next']);
});

test('a blank line ends the nested lines', () => {
  assert.deepEqual(found('- [ ] a\n  - b\n\n  - c'), ['- [ ] a|  - b']);
});

test('an unfinished child of a finished parent is found on its own', () => {
  assert.deepEqual(found('- [x] parent\n  - [ ] child\n    - note'), ['  - [ ] child|    - note']);
});

test('an unfinished child inside a rolled parent is not found twice', () => {
  assert.deepEqual(found('- [ ] parent\n  - [ ] child'), ['- [ ] parent|  - [ ] child']);
  assert.deepEqual(found('- [ ] parent\n  - [ ] child', { withChildren: false }), ['- [ ] parent', '  - [ ] child']);
});

test('tabs count as indentation', () => {
  assert.deepEqual(found('- [ ] a\n\t- b\n- [ ] c'), ['- [ ] a|\t- b', '- [ ] c']);
});

test('tasks inside code blocks are ignored', () => {
  assert.deepEqual(found('```\n- [ ] in code\n```\n- [ ] real\n~~~md\n- [ ] also code\n~~~'), ['- [ ] real']);
  assert.deepEqual(found('````\n```\n- [ ] still code\n```\n````\n- [ ] real'), ['- [ ] real']);
});

test('only the listed headings are searched', () => {
  const note = '# Day\n- [ ] top\n## Tasks\n- [ ] in tasks\n### Sub\n- [ ] in sub\n## Notes\n- [ ] in notes';
  assert.deepEqual(found(note, { headings: ['## Tasks'] }), ['- [ ] in tasks', '- [ ] in sub']);
  assert.deepEqual(found(note, { headings: ['Notes'] }), ['- [ ] in notes']);
  assert.deepEqual(found(note, { headings: ['## Tasks', '## Notes'] }), ['- [ ] in tasks', '- [ ] in sub', '- [ ] in notes']);
  assert.deepEqual(found(note, { headings: ['## Missing'] }), []);
  assert.deepEqual(found(note, { headings: ['### Tasks'] }), []);
});

test('finds a section, ignoring headings in code', () => {
  const l = lines('```\n## Tasks\n```\n## Tasks\n- a\n## Next');
  assert.deepEqual(findSection(l, '## Tasks'), { heading: 3, end: 5 });
  assert.equal(findSection(l, '## Nope'), null);
});

test('task keys ignore the checkbox, case and spacing', () => {
  assert.equal(taskKey('- [ ]   Call   Bob '), 'call bob');
  assert.equal(taskKey('  1. [x] call bob'), 'call bob');
});

test('duplicates are left out, including inside the batch', () => {
  const ts = findTasks(lines('- [ ] a\n- [ ] b\n- [ ] A\n- [ ] c'), OPTS);
  assert.deepEqual(withoutDuplicates(ts, ['- [ ] b', 'text'], true).map((t) => t.key), ['a', 'c']);
  assert.equal(withoutDuplicates(ts, ['- [ ] b'], false).length, 4);
  assert.deepEqual(withoutDuplicates(ts, ['- [x] c'], true).map((t) => t.key), ['a', 'b']);
});

test('dedent moves a nested task to the top level', () => {
  assert.deepEqual(dedent(['    - [ ] a', '      - b', '    - c']), ['- [ ] a', '  - b', '- c']);
  assert.deepEqual(dedent(['- [ ] a']), ['- [ ] a']);
  assert.deepEqual(dedent(['\t- [ ] a', '\t\t- b']), ['- [ ] a', '\t- b']);
});

test('tasks go to the end of the note', () => {
  assert.equal(insertTasks('# Today\n\nNotes here.\n', [['- [ ] a']], { heading: '' }), '# Today\n\nNotes here.\n\n- [ ] a\n');
  assert.equal(insertTasks('- [ ] x\n', [['- [ ] a']], { heading: '' }), '- [ ] x\n- [ ] a\n');
  assert.equal(insertTasks('', [['- [ ] a'], ['- [ ] b']], { heading: '' }), '- [ ] a\n- [ ] b\n');
  assert.equal(insertTasks('text', [['- [ ] a']], { heading: '' }), 'text\n\n- [ ] a');
  assert.equal(insertTasks('- [ ] x\n\n\n', [['- [ ] a']], { heading: '' }), '- [ ] x\n- [ ] a\n');
});

test('tasks go to the end of the chosen section', () => {
  const note = '# Today\n## Tasks\n- [ ] existing\n\n## Notes\nText\n';
  assert.equal(insertTasks(note, [['- [ ] a']], { heading: '## Tasks' }), '# Today\n## Tasks\n- [ ] existing\n- [ ] a\n\n## Notes\nText\n');
  assert.equal(insertTasks('## Tasks\n## Notes\n', [['- [ ] a']], { heading: '## Tasks' }), '## Tasks\n- [ ] a\n## Notes\n');
  assert.equal(insertTasks('# T\n## Tasks', [['- [ ] a']], { heading: 'tasks' }), '# T\n## Tasks\n- [ ] a');
});

test('a missing heading is created at the end', () => {
  assert.equal(insertTasks('# Today\n', [['- [ ] a']], { heading: '## Carried over' }), '# Today\n\n## Carried over\n- [ ] a\n');
  assert.equal(insertTasks('# Today', [['- [ ] a']], { heading: 'Carried' }), '# Today\n\n## Carried\n- [ ] a');
});

test('nested tasks land at the top level and Windows line endings stay', () => {
  assert.equal(insertTasks('a\r\n', [['  - [ ] n', '    - c']], { heading: '' }), 'a\r\n\r\n- [ ] n\r\n  - c\r\n');
  assert.deepEqual(splitLines('a\r\nb'), { lines: ['a', 'b'], eol: '\r\n' });
});

test('removing moved tasks takes their nested lines too', () => {
  const src = '# Old\n- [ ] a\n  - c\n- [x] b\n- [ ] d\n';
  const moved = findTasks(lines(src), OPTS).map((t) => t.lines);
  assert.equal(applyToSource(src, moved, 'remove', '>', OPTS).text, '# Old\n- [x] b\n');
});

test('marking moved tasks changes only the checkbox', () => {
  const src = '- [ ] a\n  - c\n1. [/] b';
  const moved = findTasks(lines(src), OPTS).map((t) => t.lines);
  const r = applyToSource(src, moved, 'mark', '>', OPTS);
  assert.equal(r.text, '- [>] a\n  - c\n1. [>] b');
  assert.equal(r.changed, 2);
});

test('a task edited meanwhile is left alone', () => {
  const moved = [['- [ ] a'], ['- [ ] b']];
  const r = applyToSource('- [ ] a edited\n- [ ] b\n', moved, 'remove', '>', OPTS);
  assert.equal(r.text, '- [ ] a edited\n');
  assert.equal(r.changed, 1);
});

test('one moved line removes one line even if the text repeats', () => {
  const r = applyToSource('- [ ] a\n- [ ] a\n- [ ] a\n', [['- [ ] a']], 'remove', '>', OPTS);
  assert.equal(r.text, '- [ ] a\n- [ ] a\n');
});

test('keep changes nothing', () => {
  assert.deepEqual(applyToSource('- [ ] a', [['- [ ] a']], 'keep', '>', OPTS), { text: '- [ ] a', changed: 0 });
});

test('picks the most recent earlier day', () => {
  const files = [{ p: 'a', day: 10 }, { p: 'b', day: 30 }, { p: 'c', day: 20 }, { p: 'd', day: 40 }];
  assert.equal(pickEarlier(files, 35)?.p, 'b');
  assert.equal(pickEarlier(files, 30)?.p, 'c');
  assert.equal(pickEarlier(files, 10), undefined);
  assert.deepEqual(earlierNotes(files, 35).map((f) => f.p), ['b', 'c', 'a']);
  assert.equal(earlierNotes(files, 100, 2).length, 2);
});

test('imports the original settings, ignoring nonsense', () => {
  assert.deepEqual(
    fromLegacy({ templateHeading: '## Tasks', deleteOnComplete: true, removeEmptyTodos: true, rolloverChildren: false, rolloverOnFileCreate: false, doneStatusMarkers: 'xX-?' }),
    { targetHeading: '## Tasks', sourceAction: 'remove', skipEmpty: true, withChildren: false, rolloverOnCreate: false, doneMarkers: 'xX-?' },
  );
  assert.deepEqual(fromLegacy({ templateHeading: 'none', deleteOnComplete: false }), { targetHeading: '', sourceAction: 'keep' });
  assert.deepEqual(fromLegacy({ templateHeading: 3, doneStatusMarkers: '' }), {});
});
