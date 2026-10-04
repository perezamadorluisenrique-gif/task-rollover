import { App, FuzzySuggestModal, Notice, Plugin, PluginSettingTab, Setting, TFile, moment } from 'obsidian';

/**
 * The part of moment this plugin uses, typed here: the directory's review has no types for `moment`
 * and reads every untyped call as unsafe.
 */
interface Day {
  isValid(): boolean;
  startOf(unit: 'day'): Day;
  valueOf(): number;
}
const parseDay = moment as unknown as (input?: string, format?: string, strict?: boolean) => Day;

/** Midnight today, local time, in milliseconds. */
function todayStart(): number {
  return parseDay().startOf('day').valueOf();
}
import type { SettingDefinitionItem } from 'obsidian';

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
}

interface DailyNote {
  file: TFile;
  /** Start of the note's day, in ms. */
  day: number;
}

interface Rollover {
  target: { file: TFile; before: string; after: string };
  source?: { file: TFile; before: string; after: string };
}

/** The pieces of Obsidian's internal plugin registry this reads. Not public API, but the Daily notes options are the only place its folder and format live. */
interface InternalApp {
  internalPlugins?: { plugins?: Record<string, { enabled?: boolean; instance?: { options?: { folder?: string; format?: string } } }> };
  plugins?: { getPlugin?: (id: string) => { settings?: { daily?: { enabled?: boolean; folder?: string; format?: string } } } | null };
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
    let base: { folder?: string; format?: string } | undefined;
    if (periodic?.enabled) base = periodic;
    else if (core?.enabled) base = core.instance?.options;
    const overridden = s.folderOverride.trim() !== '' || s.formatOverride.trim() !== '';
    if (!base && !overridden) return null;
    const folder = (s.folderOverride.trim() || base?.folder || '').replace(/^\/+|\/+$/g, '');
    const format = s.formatOverride.trim() || base?.format?.trim() || 'YYYY-MM-DD';
    return { folder, format };
  }

  /** The day a file is the daily note of, or null if it is not one. */
  private dayOf(file: TFile, config: DailyConfig): number | null {
    const prefix = config.folder ? `${config.folder}/` : '';
    if (!file.path.startsWith(prefix)) return null;
    const name = file.path.slice(prefix.length).replace(/\.md$/, '');
    const m = parseDay(name, config.format, true);
    return m.isValid() ? m.startOf('day').valueOf() : null;
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

    const record: Rollover = { target: { file: target, before, after: afterTarget } };
    if (this.settings.sourceAction !== 'keep') {
      let sourceBefore = '';
      let changed = 0;
      const afterSource = await this.app.vault.process(source, (data) => {
        sourceBefore = data;
        const r = applyToSource(data, blocks, this.settings.sourceAction, this.settings.movedMarker, options);
        changed = r.changed;
        return r.text;
      });
      if (changed > 0) record.source = { file: source, before: sourceBefore, after: afterSource };
    }
    this.last = record;
    this.announce(blocks.length, source, target);
  }

  private announce(count: number, source: TFile, target: TFile) {
    const notice = new Notice('', 10000);
    notice.messageEl.empty();
    notice.messageEl.createSpan({ text: `${count} unfinished ${count === 1 ? 'task' : 'tasks'} rolled over from “${source.basename}” to “${target.basename}”. ` });
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
    const parts = [last.target, ...(last.source ? [last.source] : [])];
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
