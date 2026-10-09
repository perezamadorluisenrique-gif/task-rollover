import { App, FuzzySuggestModal, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, moment } from 'obsidian';

/**
 * The part of moment this plugin uses, typed here: the directory's review has no types for `moment`
 * and reads every untyped call as unsafe.
 */
interface Day {
  isValid(): boolean;
  startOf(unit: 'day'): Day;
  subtract(amount: number, unit: 'days'): Day;
  format(pattern?: string): string;
  valueOf(): number;
}
const parseDay = moment as unknown as (input?: string, format?: string, strict?: boolean) => Day;

/** Midnight today, local time, in milliseconds. */
function todayStart(): number {
  return parseDay().startOf('day').valueOf();
}
import type { SettingDefinitionItem } from 'obsidian';

import { collectAcross, dayOfPath, inRange, insertGathered } from './src/gather.ts';
import type { Group, SourceNote } from './src/gather.ts';
import {
  applyToSource,
  earlierNotes,
  findTasks,
  fromLegacy,
  graphemes,
  insertTasks,
  pickEarlier,
  splitLines,
  withoutDuplicates,
} from './src/tasks.ts';
import type { LegacySettings, ParseOptions, SourceAction, Task } from './src/tasks.ts';

interface TaskRolloverSettings {
  /** Roll over by itself when today's daily note is created. */
  rolloverOnCreate: boolean;
  /** What happens to the task in the earlier note. */
  sourceAction: SourceAction;
  /** The checkbox character for "moved", when the earlier note is marked. */
  movedMarker: string;
  withChildren: boolean;
  skipEmpty: boolean;
  skipDuplicates: boolean;
  /** Checkbox characters that mean finished. */
  doneMarkers: string;
  /** Only tasks under these headings, one per line. Empty: the whole note. */
  sourceHeadings: string[];
  /** Where the tasks go in today's note. Empty: the end. */
  targetHeading: string;
  /** Use these instead of the Daily notes plugin's folder and format. */
  folderOverride: string;
  formatOverride: string;
  legacyChecked: boolean;
}

const DEFAULT_SETTINGS: TaskRolloverSettings = {
  rolloverOnCreate: true,
  sourceAction: 'keep',
  movedMarker: '>',
  withChildren: true,
  skipEmpty: true,
  skipDuplicates: true,
  doneMarkers: 'xX-',
  sourceHeadings: [],
  targetHeading: '',
  folderOverride: '',
  formatOverride: '',
  legacyChecked: false,
};

const ACTIONS: Record<SourceAction, string> = {
  keep: 'Leave it as it is',
  mark: 'Mark it as moved',
  remove: 'Remove it',
};

/** Where Rollover Daily Todos keeps its settings, relative to the config folder. */
const LEGACY_DATA = 'plugins/obsidian-rollover-daily-todos/data.json';

/** A daily note created this recently counts as just created. */
const JUST_CREATED_MS = 15000;

/** Names and descriptions shared by the 1.13+ declarative tab and the older `display()`. */
const TEXT = {
  rolloverOnCreate: {
    name: 'Roll over when the daily note is created',
    desc: 'Off if you would rather run the command yourself, for example when another plugin builds your daily notes.',
  },
  sourceAction: {
    name: 'In the earlier note, a rolled task',
    desc: 'Stays, gets its checkbox changed to the moved marker, or is removed with its nested lines.',
  },
  movedMarker: { name: 'Moved marker', desc: 'The checkbox character put on a task that moved, such as > for [>]. It never rolls over again.' },
  withChildren: { name: 'Bring nested lines along', desc: 'Sub-bullets, notes and sub-tasks under a task move with it.' },
  skipEmpty: { name: 'Skip empty tasks', desc: 'A checkbox with no text, like a leftover from a template, does not roll over.' },
  skipDuplicates: {
    name: 'Skip tasks already in the note',
    desc: 'A task whose text is already a checkbox in today’s note is not added again, so running it twice is harmless.',
  },
  doneMarkers: { name: 'Finished markers', desc: 'Checkbox characters that mean finished, without spaces. For example xX- also treats [-] as done.' },
  sourceHeadings: {
    name: 'Only roll over tasks under these headings',
    desc: 'One heading per line, such as ## Tasks. Leave empty to roll over unfinished tasks from anywhere in the note.',
  },
  targetHeading: {
    name: 'Put them under this heading',
    desc: 'The heading of today’s note that gets the tasks, such as ## Tasks. They go at the end of that section. Created if missing. Leave empty for the end of the note.',
  },
  folderOverride: {
    name: 'Daily notes folder',
    desc: 'Leave empty to use the Daily notes (or Periodic Notes) plugin’s folder.',
  },
  formatOverride: {
    name: 'Daily notes date format',
    desc: 'Leave empty to use the Daily notes (or Periodic Notes) plugin’s format, for example YYYY-MM-DD.',
  },
  legacy: {
    name: 'Import from Rollover Daily Todos',
    desc: 'Copy the settings of the original plugin, if it is installed in this vault.',
  },
};

interface DailyConfig {
  folder: string;
  format: string;
  /** The Daily notes template, used when a note has to be created. */
  template?: string;
}

interface DailyNote {
  file: TFile;
  /** Start of the note's day, in ms. */
  day: number;
}

interface Part {
  file: TFile;
  before: string;
  after: string;
}

/** What the last rollover changed: the target and every source note, undone together. */
interface Rollover {
  target: Part;
  sources: Part[];
}

/** How far back "Gather" looks, in days; null is every past daily note. */
const RANGES: Record<string, { label: string; days: number | null }> = {
  '7': { label: 'Last 7 days', days: 7 },
  '30': { label: 'Last 30 days', days: 30 },
  '90': { label: 'Last 90 days', days: 90 },
  all: { label: 'All past daily notes', days: null },
};

interface GatherGroup extends Group {
  file: TFile;
}

/** The pieces of Obsidian's internal plugin registry this reads. Not public API, but the Daily notes options are the only place its folder and format live. */
interface InternalApp {
  internalPlugins?: { plugins?: Record<string, { enabled?: boolean; instance?: { options?: { folder?: string; format?: string; template?: string } } }> };
  plugins?: { getPlugin?: (id: string) => { settings?: { daily?: { enabled?: boolean; folder?: string; format?: string; template?: string } } } | null };
}

export default class TaskRolloverPlugin extends Plugin {
  settings: TaskRolloverSettings = { ...DEFAULT_SETTINGS };
  private last: Rollover | null = null;
  private busy = new Set<string>();

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new TaskRolloverSettingTab(this.app, this));

    this.addCommand({
      id: 'roll-over',
      name: 'Roll over unfinished tasks now',
      icon: 'list-checks',
      callback: () => void this.rolloverNow(),
    });
    this.addCommand({
      id: 'roll-over-from',
      name: 'Roll over unfinished tasks from another daily note',
      icon: 'calendar-search',
      callback: () => this.pickSource(),
    });
    this.addCommand({
      id: 'gather',
      name: 'Gather unfinished tasks from past daily notes…',
      icon: 'calendar-range',
      callback: () => this.openGather(),
    });
    this.addCommand({
      id: 'undo',
      name: 'Undo the last rollover',
      icon: 'undo-2',
      checkCallback: (checking) => {
        if (!this.last) return false;
        if (!checking) void this.undo();
        return true;
      },
    });

    // Vault events for every file arrive while the vault loads; register once the layout is ready.
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on('create', (file) => {
          if (file instanceof TFile && file.extension === 'md') void this.onCreate(file);
        }),
      );
      void this.offerLegacyImport();
    });
  }

  async loadSettings() {
    const data = (await this.loadData()) as Partial<TaskRolloverSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private parseOptions(): ParseOptions {
    const s = this.settings;
    return {
      // A task marked as moved has moved: it never rolls again.
      doneMarkers: s.sourceAction === 'mark' ? s.doneMarkers + s.movedMarker : s.doneMarkers,
      withChildren: s.withChildren,
      skipEmpty: s.skipEmpty,
      headings: s.sourceHeadings,
    };
  }

  /** The folder and date format of daily notes, or null when nothing says. */
  dailyConfig(): DailyConfig | null {
    const s = this.settings;
    const app = this.app as unknown as InternalApp;
    const periodic = app.plugins?.getPlugin?.('periodic-notes')?.settings?.daily;
    const core = app.internalPlugins?.plugins?.['daily-notes'];
    let base: { folder?: string; format?: string; template?: string } | undefined;
    if (periodic?.enabled) base = periodic;
    else if (core?.enabled) base = core.instance?.options;
    const overridden = s.folderOverride.trim() !== '' || s.formatOverride.trim() !== '';
    if (!base && !overridden) return null;
    const folder = (s.folderOverride.trim() || base?.folder || '').replace(/^\/+|\/+$/g, '');
    const format = s.formatOverride.trim() || base?.format?.trim() || 'YYYY-MM-DD';
    return { folder, format, template: base?.template?.trim() || undefined };
  }

  /** The day a file is the daily note of, or null if it is not one. */
  private dayOf(file: TFile, config: DailyConfig): number | null {
    return dayOfPath(file.path, config.folder, (name) => {
      const m = parseDay(name, config.format, true);
      return m.isValid() ? m.startOf('day').valueOf() : null;
    });
  }

  private dailyNotes(config: DailyConfig): DailyNote[] {
    const notes: DailyNote[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const day = this.dayOf(file, config);
      if (day !== null) notes.push({ file, day });
    }
    return notes;
  }

  /**
   * Wait for a note that another plugin may still be filling in: Templater and its kind write a moment after
   * the note exists. Done once the text has stopped changing, and an empty note gets a few seconds more.
   */
  private async settled(file: TFile): Promise<void> {
    const start = Date.now();
    let previous = await this.app.vault.read(file);
    let stable = 0;
    while (Date.now() - start < 8000) {
      await new Promise((resolve) => window.setTimeout(resolve, 400));
      const now = await this.app.vault.read(file);
      const quiet = now === previous && (now.trim() !== '' || Date.now() - start >= 3000);
      stable = quiet ? stable + 1 : 0;
      previous = now;
      if (stable >= 2) return;
    }
  }

  private async onCreate(file: TFile) {
    if (!this.settings.rolloverOnCreate || this.busy.has(file.path)) return;
    if (Date.now() - file.stat.ctime > JUST_CREATED_MS) return;
    const config = this.dailyConfig();
    if (!config) return;
    const day = this.dayOf(file, config);
    if (day === null || day !== todayStart()) return;
    this.busy.add(file.path);
    try {
      await this.settled(file);
      await this.rollover(file, undefined, config, true);
    } finally {
      this.busy.delete(file.path);
    }
  }

  /** Into the note in front of you if it is a daily note, else into today's. */
  private async rolloverNow() {
    const config = this.dailyConfig();
    if (!config) {
      new Notice('Turn on the Daily notes plugin (or Periodic Notes with daily notes), or set the folder and date format in this plugin’s settings.');
      return;
    }
    const target = this.targetNote(config);
    if (!target) {
      new Notice('Today’s daily note does not exist yet. Open it first, then run this again.');
      return;
    }
    await this.rollover(target, undefined, config, false);
  }

  private targetNote(config: DailyConfig): TFile | null {
    const active = this.app.workspace.getActiveFile();
    if (active && this.dayOf(active, config) !== null) return active;
    const today = todayStart();
    return this.dailyNotes(config).find((n) => n.day === today)?.file ?? null;
  }

  private pickSource() {
    const config = this.dailyConfig();
    if (!config) {
      new Notice('Turn on the Daily notes plugin, or set the folder and date format in this plugin’s settings.');
      return;
    }
    const target = this.targetNote(config);
    const targetDay = target ? this.dayOf(target, config) : null;
    if (!target || targetDay === null) {
      new Notice('Open the daily note that should get the tasks first.');
      return;
    }
    const candidates = earlierNotes(this.dailyNotes(config), targetDay);
    if (candidates.length === 0) {
      new Notice('There is no earlier daily note.');
      return;
    }
    new SourceModal(this.app, candidates.map((c) => c.file), (from) => void this.rollover(target, from, config, false)).open();
  }

  /**
   * Move the unfinished tasks of `from` (default: the most recent earlier daily note) into `target`.
   * Each note is changed in one `process` call, so an edit made a moment earlier is never overwritten.
   */
  async rollover(target: TFile, from: TFile | undefined, config: DailyConfig, auto: boolean): Promise<void> {
    const targetDay = this.dayOf(target, config);
    if (from === undefined) {
      if (targetDay === null) return;
      from = pickEarlier(this.dailyNotes(config), targetDay)?.file;
      if (!from) {
        if (!auto) new Notice('There is no earlier daily note to roll over from.');
        return;
      }
    }
    const source = from;
    const options = this.parseOptions();
    const found = findTasks(splitLines(await this.app.vault.read(source)).lines, options);
    if (found.length === 0) {
      if (!auto) new Notice(`No unfinished tasks in “${source.basename}”.`);
      return;
    }

    let blocks: string[][] = [];
    let before = '';
    const afterTarget = await this.app.vault.process(target, (data) => {
      before = data;
      const fresh = withoutDuplicates(found, splitLines(data).lines, this.settings.skipDuplicates);
      blocks = fresh.map((t: Task) => t.lines);
      return insertTasks(data, blocks, { heading: this.settings.targetHeading });
    });
    if (blocks.length === 0) {
      if (!auto) new Notice(`Everything unfinished in “${source.basename}” is already in “${target.basename}”.`);
      return;
    }

    const record: Rollover = { target: { file: target, before, after: afterTarget }, sources: [] };
    if (this.settings.sourceAction !== 'keep') {
      let sourceBefore = '';
      let changed = 0;
      const afterSource = await this.app.vault.process(source, (data) => {
        sourceBefore = data;
        const r = applyToSource(data, blocks, this.settings.sourceAction, this.settings.movedMarker, options);
        changed = r.changed;
        return r.text;
      });
      if (changed > 0) record.sources.push({ file: source, before: sourceBefore, after: afterSource });
    }
    this.last = record;
    this.announce(blocks.length, source, target);
  }

  private openGather() {
    const config = this.dailyConfig();
    if (!config) {
      new Notice('Turn on the Daily notes plugin (or Periodic Notes with daily notes), or set the folder and date format in this plugin’s settings.');
      return;
    }
    new GatherModal(this.app, this, config).open();
  }

  /** The past daily notes within `days` days (null: all), read, with the unfinished tasks that would move into today's note. */
  async gatherPlan(config: DailyConfig, days: number | null): Promise<GatherGroup[]> {
    const today = todayStart();
    const cutoff = days === null ? null : parseDay().startOf('day').subtract(days, 'days').valueOf();
    const notes = this.dailyNotes(config).filter((n) => inRange(n.day, today, cutoff));
    const sources: SourceNote[] = [];
    const files = new Map<string, TFile>();
    for (const n of notes) {
      sources.push({ id: n.file.path, day: n.day, text: await this.app.vault.cachedRead(n.file) });
      files.set(n.file.path, n.file);
    }
    const existing = this.todayNote(config);
    const existingText = existing ? await this.app.vault.read(existing) : '';
    const plan: GatherGroup[] = [];
    for (const g of collectAcross(sources, this.parseOptions(), splitLines(existingText).lines, this.settings.skipDuplicates)) {
      const file = files.get(g.id);
      if (file) plan.push({ ...g, file });
    }
    return plan;
  }

  private todayNote(config: DailyConfig): TFile | null {
    const today = todayStart();
    return this.dailyNotes(config).find((n) => n.day === today)?.file ?? null;
  }

  /** Today's daily note, created from the Daily notes template when it does not exist. */
  private async ensureToday(config: DailyConfig): Promise<TFile> {
    const existing = this.todayNote(config);
    if (existing) return existing;
    const now = parseDay();
    const name = now.format(config.format);
    const path = `${config.folder ? `${config.folder}/` : ''}${name}.md`;
    // Creating the note must not also trigger the automatic rollover of yesterday's tasks.
    this.busy.add(path);
    const parts = path.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
    }
    let content = '';
    if (config.template) {
      const tpl = this.app.metadataCache.getFirstLinkpathDest(config.template, '');
      if (tpl) {
        content = (await this.app.vault.cachedRead(tpl))
          .replace(/{{\s*(date|time)\s*(?::([^}]*))?}}/gi, (_m, kind: string, fmt?: string) =>
            now.format(fmt?.trim() || (kind.toLowerCase() === 'time' ? 'HH:mm' : 'YYYY-MM-DD')),
          )
          .replace(/{{\s*title\s*}}/gi, name.split('/').pop() ?? name);
      }
    }
    return this.app.vault.create(path, content);
  }

  /**
   * Move the chosen tasks of many past notes into today's note (created if missing) and change each source
   * note as the setting says. One undo record covers all of it.
   */
  async gatherApply(config: DailyConfig, picks: { file: TFile; tasks: Task[] }[]): Promise<void> {
    const chosen = picks.filter((p) => p.tasks.length > 0);
    if (chosen.length === 0) return;
    let target: TFile | null = null;
    try {
      target = await this.ensureToday(config);
      const file = target;
      this.busy.add(file.path);
      let before = '';
      let taken = new Map<string, Task[]>();
      const afterTarget = await this.app.vault.process(file, (data) => {
        before = data;
        const r = insertGathered(data, chosen.map((p) => ({ id: p.file.path, tasks: p.tasks })), { heading: this.settings.targetHeading }, this.settings.skipDuplicates);
        taken = r.taken;
        return r.text;
      });
      let count = 0;
      for (const t of taken.values()) count += t.length;
      if (count === 0) {
        new Notice(`Everything you picked is already in “${file.basename}”.`);
        return;
      }
      const record: Rollover = { target: { file, before, after: afterTarget }, sources: [] };
      const options = this.parseOptions();
      if (this.settings.sourceAction !== 'keep') {
        for (const p of chosen) {
          const moved = taken.get(p.file.path);
          if (!moved) continue;
          let sourceBefore = '';
          let changed = 0;
          const afterSource = await this.app.vault.process(p.file, (data) => {
            sourceBefore = data;
            const r = applyToSource(data, moved.map((t) => t.lines), this.settings.sourceAction, this.settings.movedMarker, options);
            changed = r.changed;
            return r.text;
          });
          if (changed > 0) record.sources.push({ file: p.file, before: sourceBefore, after: afterSource });
        }
      }
      this.last = record;
      const notes = taken.size;
      this.announceText(`${count} unfinished ${count === 1 ? 'task' : 'tasks'} gathered from ${notes} ${notes === 1 ? 'note' : 'notes'} into “${file.basename}”. `);
    } finally {
      if (target) this.busy.delete(target.path);
    }
  }

  private announce(count: number, source: TFile, target: TFile) {
    this.announceText(`${count} unfinished ${count === 1 ? 'task' : 'tasks'} rolled over from “${source.basename}” to “${target.basename}”. `);
  }

  private announceText(text: string) {
    const notice = new Notice('', 10000);
    notice.messageEl.empty();
    notice.messageEl.createSpan({ text });
    notice.messageEl.createEl('button', { text: 'Undo' }).addEventListener('click', () => {
      notice.hide();
      void this.undo();
    });
  }

  /** Put both notes back, as long as nobody changed them since the rollover. */
  async undo(): Promise<void> {
    const last = this.last;
    if (!last) {
      new Notice('There is nothing to undo.');
      return;
    }
    const parts = [last.target, ...last.sources];
    for (const p of parts) {
      if ((await this.app.vault.read(p.file)) !== p.after) {
        new Notice(`Can’t undo: “${p.file.basename}” has changed since the rollover.`);
        return;
      }
    }
    for (const p of parts) {
      await this.app.vault.process(p.file, (data) => (data === p.after ? p.before : data));
    }
    this.last = null;
    new Notice('Rollover undone.');
  }

  private async readLegacy(): Promise<LegacySettings | null> {
    const path = `${this.app.vault.configDir}/${LEGACY_DATA}`;
    if (!(await this.app.vault.adapter.exists(path))) return null;
    try {
      return JSON.parse(await this.app.vault.adapter.read(path)) as LegacySettings;
    } catch {
      return null;
    }
  }

  /** Copy Rollover Daily Todos's settings. Returns false if there were none. */
  async importLegacy(): Promise<boolean> {
    const legacy = await this.readLegacy();
    if (!legacy) return false;
    Object.assign(this.settings, fromLegacy(legacy), { legacyChecked: true });
    await this.saveSettings();
    return true;
  }

  /** On first run, adopt the original's settings and say so once. */
  private async offerLegacyImport() {
    if (this.settings.legacyChecked) return;
    const imported = await this.importLegacy();
    if (imported) new Notice('Imported your settings from Rollover Daily Todos. Turn that plugin off, or every new daily note gets its tasks twice.', 10000);
    this.settings.legacyChecked = true;
    await this.saveSettings();
  }
}

class SourceModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private files: TFile[],
    private choose: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder('Roll over the unfinished tasks of…');
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.basename;
  }

  onChooseItem(file: TFile): void {
    this.choose(file);
  }
}

/** Pick how far back to look, review the unfinished tasks of every past daily note, and move the ticked ones into today's note. */
class GatherModal extends Modal {
  private range = '30';
  private groups: GatherGroup[] = [];
  private ticked = new Set<Task>();
  private listEl!: HTMLElement;
  private applyBtn!: HTMLButtonElement;
  private loads = 0;

  constructor(
    app: App,
    private plugin: TaskRolloverPlugin,
    private config: DailyConfig,
  ) {
    super(app);
  }

  onOpen() {
    this.setTitle('Gather unfinished tasks');
    const { contentEl } = this;
    new Setting(contentEl)
      .setName('Look back')
      .setDesc('Unfinished tasks of daily notes before today, newest note first. Identical tasks are listed once, from the newest note.')
      .addDropdown((d) => {
        for (const [key, r] of Object.entries(RANGES)) d.addOption(key, r.label);
        d.setValue(this.range).onChange((v) => {
          this.range = v;
          void this.load();
        });
      });
    this.listEl = contentEl.createDiv({ cls: 'task-rollover-gather-list' });
    const footer = contentEl.createDiv({ cls: 'modal-button-container' });
    this.applyBtn = footer.createEl('button', { text: 'Move into today', cls: 'mod-cta' });
    this.applyBtn.addEventListener('click', () => void this.apply());
    footer.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    void this.load();
  }

  onClose() {
    this.loads++;
    this.contentEl.empty();
  }

  private async load() {
    const mine = ++this.loads;
    this.listEl.empty();
    this.listEl.createEl('p', { text: 'Reading daily notes…' });
    this.applyBtn.disabled = true;
    const groups = await this.plugin.gatherPlan(this.config, RANGES[this.range].days);
    if (mine !== this.loads) return;
    this.groups = groups;
    this.ticked = new Set(groups.reduce<Task[]>((all, g) => all.concat(g.tasks), []));
    this.render();
  }

  private render() {
    this.listEl.empty();
    if (this.groups.length === 0) {
      this.listEl.createEl('p', { text: 'No unfinished tasks in that range, or they are all in today’s note already.' });
    }
    for (const g of this.groups) {
      const section = this.listEl.createDiv();
      section.createEl('h4', { text: g.file.basename });
      for (const t of g.tasks) {
        const label = section.createEl('label', { cls: 'setting-item-description' });
        const box = label.createEl('input', { type: 'checkbox' });
        box.checked = true;
        box.addEventListener('change', () => {
          if (box.checked) this.ticked.add(t);
          else this.ticked.delete(t);
          this.refresh();
        });
        const extra = t.lines.length - 1;
        const text = t.lines[0].replace(/^\s*(?:[-*+]|\d+[.)])[ \t]+\[.\][ \t]*/u, '') || '(empty)';
        label.createSpan({ text: ` ${text}${extra > 0 ? ` (+${extra} nested ${extra === 1 ? 'line' : 'lines'})` : ''}` });
      }
    }
    this.refresh();
  }

  private refresh() {
    const n = this.ticked.size;
    this.applyBtn.disabled = n === 0;
    this.applyBtn.setText(n === 0 ? 'Move into today' : `Move ${n} ${n === 1 ? 'task' : 'tasks'} into today`);
  }

  private async apply() {
    const picks = this.groups.map((g) => ({ file: g.file, tasks: g.tasks.filter((t) => this.ticked.has(t)) }));
    this.close();
    await this.plugin.gatherApply(this.config, picks);
  }
}

class TaskRolloverSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: TaskRolloverPlugin,
  ) {
    super(app, plugin);
  }

  /**
   * The settings, described rather than drawn. Obsidian 1.13 and later
   * renders this itself and indexes it for the settings search. Older
   * versions ignore it and call `display()`.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const s = this.plugin.settings;
    const d = DEFAULT_SETTINGS;
    return [
      {
        type: 'group',
        heading: 'Rolling over',
        items: [
          { ...TEXT.rolloverOnCreate, control: { type: 'toggle', key: 'rolloverOnCreate', defaultValue: d.rolloverOnCreate } },
          { ...TEXT.sourceAction, control: { type: 'dropdown', key: 'sourceAction', options: ACTIONS, defaultValue: d.sourceAction } },
          {
            ...TEXT.movedMarker,
            visible: () => s.sourceAction === 'mark',
            control: { type: 'text', key: 'movedMarker', placeholder: '>', defaultValue: d.movedMarker },
          },
          { ...TEXT.withChildren, control: { type: 'toggle', key: 'withChildren', defaultValue: d.withChildren } },
          { ...TEXT.skipEmpty, control: { type: 'toggle', key: 'skipEmpty', defaultValue: d.skipEmpty } },
          { ...TEXT.skipDuplicates, control: { type: 'toggle', key: 'skipDuplicates', defaultValue: d.skipDuplicates } },
          { ...TEXT.doneMarkers, control: { type: 'text', key: 'doneMarkers', placeholder: 'xX-', defaultValue: d.doneMarkers } },
        ],
      },
      {
        type: 'group',
        heading: 'Where tasks come from and go',
        items: [
          { ...TEXT.sourceHeadings, control: { type: 'textarea', key: 'sourceHeadings', rows: 3, placeholder: '## Tasks', defaultValue: '' } },
          { ...TEXT.targetHeading, control: { type: 'text', key: 'targetHeading', placeholder: '## Tasks', defaultValue: d.targetHeading } },
        ],
      },
      {
        type: 'group',
        heading: 'Daily notes',
        items: [
          { ...TEXT.folderOverride, control: { type: 'text', key: 'folderOverride', placeholder: 'Journal', defaultValue: '' } },
          { ...TEXT.formatOverride, control: { type: 'text', key: 'formatOverride', placeholder: 'YYYY-MM-DD', defaultValue: '' } },
        ],
      },
      { ...TEXT.legacy, action: () => void this.importLegacy() },
    ];
  }

  /** The heading list is stored as an array but edited as text. */
  getControlValue(key: string): unknown {
    const s = this.plugin.settings;
    if (key === 'sourceHeadings') return s.sourceHeadings.join('\n');
    return (s as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings;
    if (key === 'sourceHeadings') {
      s.sourceHeadings = String(value)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    } else if (key === 'movedMarker') {
      // One character, never a space: a space would turn the task into an unfinished one again.
      const one = graphemes(String(value).trim())[0];
      s.movedMarker = one ?? DEFAULT_SETTINGS.movedMarker;
    } else if (key === 'doneMarkers') {
      s.doneMarkers = String(value).replace(/\s/g, '');
    } else Object.assign(s, { [key]: value });
    await this.plugin.saveSettings();
    // Obsidian 1.13's re-check of `visible`, looked up because older versions lack it.
    if (key === 'sourceAction') (this as unknown as { refreshDomState?: () => void }).refreshDomState?.();
  }

  private async importLegacy() {
    if (await this.plugin.importLegacy()) {
      new Notice('Imported the settings of Rollover Daily Todos.');
      this.redraw();
    } else new Notice('Rollover Daily Todos has no settings in this vault.');
  }

  private legacy = false;

  private redraw() {
    if (this.legacy) {
      this.draw();
      return;
    }
    // Obsidian 1.13's re-render of the declarative definitions, looked up because older versions lack it.
    (this as unknown as { update?: () => void }).update?.();
  }

  /** The pre-1.13 rendering, from the same text. Obsidian skips it once `getSettingDefinitions()` returns anything. */
  display(): void {
    this.legacy = true;
    this.draw();
  }

  private draw(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();
    new Setting(containerEl).setName('Rolling over').setHeading();
    this.toggle('rolloverOnCreate', TEXT.rolloverOnCreate);
    new Setting(containerEl)
      .setName(TEXT.sourceAction.name)
      .setDesc(TEXT.sourceAction.desc)
      .addDropdown((d) =>
        d
          .addOptions(ACTIONS)
          .setValue(s.sourceAction)
          .onChange(async (v) => {
            await this.setControlValue('sourceAction', v);
            this.draw();
          }),
      );
    if (s.sourceAction === 'mark') this.text('movedMarker', TEXT.movedMarker);
    this.toggle('withChildren', TEXT.withChildren);
    this.toggle('skipEmpty', TEXT.skipEmpty);
    this.toggle('skipDuplicates', TEXT.skipDuplicates);
    this.text('doneMarkers', TEXT.doneMarkers);
    new Setting(containerEl).setName('Where tasks come from and go').setHeading();
    new Setting(containerEl)
      .setName(TEXT.sourceHeadings.name)
      .setDesc(TEXT.sourceHeadings.desc)
      .addTextArea((t) => {
        t.setPlaceholder('## Tasks')
          .setValue(String(this.getControlValue('sourceHeadings')))
          .onChange((v) => this.setControlValue('sourceHeadings', v));
        t.inputEl.rows = 3;
      });
    this.text('targetHeading', TEXT.targetHeading);
    new Setting(containerEl).setName('Daily notes').setHeading();
    this.text('folderOverride', TEXT.folderOverride);
    this.text('formatOverride', TEXT.formatOverride);
    new Setting(containerEl)
      .setName(TEXT.legacy.name)
      .setDesc(TEXT.legacy.desc)
      .addButton((b) => b.setButtonText('Import').onClick(() => void this.importLegacy()));
  }

  private toggle(key: keyof TaskRolloverSettings, text: { name: string; desc: string }) {
    new Setting(this.containerEl)
      .setName(text.name)
      .setDesc(text.desc)
      .addToggle((t) => t.setValue(Boolean(this.plugin.settings[key])).onChange((v) => this.setControlValue(key, v)));
  }

  private text(key: keyof TaskRolloverSettings, text: { name: string; desc: string }) {
    new Setting(this.containerEl)
      .setName(text.name)
      .setDesc(text.desc)
      .addText((t) => t.setValue(String(this.plugin.settings[key])).onChange((v) => this.setControlValue(key, v)));
  }
}
