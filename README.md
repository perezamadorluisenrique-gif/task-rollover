# Task Rollover

Unfinished tasks from yesterday's daily note show up in today's, by
themselves, the moment today's note is created.

Yesterday's note:

```markdown
## Tasks
- [x] Send the invoice
- [ ] Write the report
  - the draft is in Drive
- [/] Review Ana's pull request
```

Today's note, when you open it:

```markdown
## Tasks
- [ ] Write the report
  - the draft is in Drive
- [/] Review Ana's pull request
```

![Today's daily note with the three unfinished tasks under the Tasks heading and a notice "3 unfinished tasks rolled over" with an Undo button](https://raw.githubusercontent.com/perezamadorluisenrique-gif/task-rollover/main/docs/rollover.png)

A notice says how many tasks moved and has an **Undo** button. Anything that is
not marked finished counts as unfinished, so tasks with custom status
characters (`[/]`, `[?]`, `[!]`) roll over too.

Works on desktop and mobile. It reads the folder and date format from the core
**Daily notes** plugin, or from **Periodic Notes** when its daily notes are on.

## What it does that you may miss elsewhere

- **Waits for your template.** If another plugin such as Templater fills the
  new note a moment after it is created, the tasks are added once the note has
  stopped changing, not on top of a half-written template.
- **No duplicates.** A task whose text is already a checkbox in today's note is
  not added again, so running the command twice is harmless.
- **Puts tasks where you want them.** Give a heading and they go at the end of
  that section (made if it is missing). Optionally only take tasks from under
  certain headings of the earlier note.
- **Keeps nested lines with their task**, and moves a nested task to the top
  level when it rolls alone.
- **Leaves code alone.** Checkboxes inside fenced code blocks are ignored.
- **Cannot delete the wrong line.** When the earlier note is changed after a
  rollover, each moved task is found again and checked before it is touched, so
  a line you edited in the meantime is left as it is, and removing one task
  never removes another line that happens to read the same.
- **A real undo.** It puts both notes back exactly as they were, for as long as
  neither has changed since. If one has, it says so instead of overwriting your
  work.

## Settings

| Setting | Default | What it does |
|---|---|---|
| Roll over when the daily note is created | on | Turn off to roll over only with the command. |
| In the earlier note, a rolled task | Leave it as it is | Or mark it as moved (`[>]`, it never rolls again), or remove it with its nested lines. |
| Moved marker | `>` | The checkbox character for "moved". |
| Bring nested lines along | on | Sub-bullets, notes and sub-tasks move with their task. |
| Skip empty tasks | on | A checkbox with no text does not roll over. |
| Skip tasks already in the note | on | No repeats in today's note. |
| Finished markers | `xX-` | Checkbox characters that mean finished. |
| Only roll over tasks under these headings | none | One heading per line, such as `## Tasks`. |
| Put them under this heading | none | A heading of today's note, such as `## Tasks`. Empty means the end of the note. |
| Daily notes folder, date format | from the plugin | Only needed when no Daily notes plugin is on. |

## Commands

| Command | What it does |
|---|---|
| Roll over unfinished tasks now | Into the daily note in front of you, or today's if you are elsewhere, from the most recent earlier daily note. |
| Roll over unfinished tasks from another daily note | Pick which earlier note to take them from, for example after a week away. |
| Undo the last rollover | Puts both notes back. Only shown while there is something to undo. |

## Coming from Rollover Daily Todos

This plugin does what
[Rollover Daily Todos](https://github.com/lumoe/obsidian-rollover-daily-todos)
does, and adds the items above plus the moved marker and choosing another note
to roll from. On first run it copies that plugin's settings (heading, delete,
children, finished markers, automatic rollover), and **Settings → Import from
Rollover Daily Todos** does it again at any time. Turn the old plugin off, or
every new daily note gets its tasks twice.

## Installation

In Obsidian, open **Settings → Community plugins → Browse** and search for
"Task Rollover".

## More plugins by Siulved54

| Plugin | What it does | Source |
| --- | --- | --- |
| [Shared Blocks](https://obsidian.md/plugins?id=shared-blocks) | Write a block of text once and reuse it in any note. Edit the source and every reference re-renders live. | [shared-blocks](https://github.com/perezamadorluisenrique-gif/shared-blocks) |
| [Text Case and Cleanup](https://obsidian.md/plugins?id=text-format) | Change case, make camelCase or slugs, sort lines and remove duplicates, and repair text pasted out of a PDF, without touching code or URLs. | [text-format](https://github.com/perezamadorluisenrique-gif/text-format) |
| [Typography as You Type](https://obsidian.md/plugins?id=typography-as-you-type) | Curly quotes, dashes and ellipses as you type, kept out of code and maths, with Backspace to take one back. | [smart-typography-plugin](https://github.com/perezamadorluisenrique-gif/smart-typography-plugin) |
| [Section Numbering](https://obsidian.md/plugins?id=section-numbering) | Number headings as an outline (1, 1.1, 1.2) and keep every link to them working when they renumber. | [section-numbering](https://github.com/perezamadorluisenrique-gif/section-numbering) |
| [Spreadsheet to Table](https://obsidian.md/plugins?id=spreadsheet-to-table) | Paste cells from Excel or Google Sheets as a Markdown table with a real header, insert CSV files, and copy tables back out. | [spreadsheet-to-table](https://github.com/perezamadorluisenrique-gif/spreadsheet-to-table) |
| [Hybrid Line Numbers](https://obsidian.md/plugins?id=hybrid-line-numbers) | Relative and hybrid line numbers for Vim-style jumps, where a folded section counts as one line. | [hybrid-line-numbers](https://github.com/perezamadorluisenrique-gif/hybrid-line-numbers) |
| [List Item Callouts](https://obsidian.md/plugins?id=list-item-callouts) | Colour a single list item as a callout by starting it with a character such as `&`, `!` or `?`. | [list-item-callouts](https://github.com/perezamadorluisenrique-gif/list-item-callouts) |
| [Folder Counts](https://obsidian.md/plugins?id=folder-counts) | See how many notes or files each folder holds, right in the file explorer, with a vault total and folder exclusions. | [folder-counts](https://github.com/perezamadorluisenrique-gif/folder-counts) |
| [Note Reading Time](https://obsidian.md/plugins?id=note-reading-time) | Reading time of the current note or your selection in the status bar, optionally saved to a property. | [note-reading-time](https://github.com/perezamadorluisenrique-gif/note-reading-time) |
| [Zoom Into Section](https://obsidian.md/plugins?id=zoom-into-section) | Zoom into a heading or list item to see only it and its contents, with a breadcrumb bar to climb back out. | [zoom-into-section](https://github.com/perezamadorluisenrique-gif/zoom-into-section) |
| [Link Title on Paste](https://obsidian.md/plugins?id=link-title-on-paste) | Paste a web address and get a Markdown link with the page's title, fetched in the background and undone in one step. | [link-title-on-paste](https://github.com/perezamadorluisenrique-gif/link-title-on-paste) |
| [Update Radar](https://obsidian.md/plugins?id=update-radar) | Checks your installed community plugins for updates in the background, shows what changed, and flags the ones that look abandoned. | [community-update-checker](https://github.com/perezamadorluisenrique-gif/community-update-checker) |
| [Dataview to Bases](https://obsidian.md/plugins?id=dataview-to-bases) | Convert Dataview queries into Bases blocks, and see which queries in your vault can be converted. | [dataview-to-bases](https://github.com/perezamadorluisenrique-gif/dataview-to-bases) |
| [Line Editing Commands](https://obsidian.md/plugins?id=line-editing-commands) | Duplicate, join, sort and reverse lines, insert blank lines and jump to a line number, with multi-cursor support. | [line-editing-commands](https://github.com/perezamadorluisenrique-gif/line-editing-commands) |
| [Note Mover Rules](https://obsidian.md/plugins?id=note-mover-rules) | Move notes into folders by ordered rules on tags, properties, titles and paths, with a preview before any bulk move. | [note-mover-rules](https://github.com/perezamadorluisenrique-gif/note-mover-rules) |
| [Tab History](https://obsidian.md/plugins?id=tab-history) | Keeps each tab's back and forward history across restarts, and adds commands to move, maximize and close tabs. | [tab-history](https://github.com/perezamadorluisenrique-gif/tab-history) |
| [URL Cards](https://obsidian.md/plugins?id=url-cards) | Shows web addresses as cards with title, description and image, and reads existing cardlink blocks. | [url-cards](https://github.com/perezamadorluisenrique-gif/url-cards) |
| [Vim Config](https://obsidian.md/plugins?id=vim-config) | Loads a vimrc-style file from your vault so your key mappings and editor commands are ready when vim mode starts. | [vim-config](https://github.com/perezamadorluisenrique-gif/vim-config) |
| [Task Archive](https://obsidian.md/plugins?id=task-archive) | Moves completed tasks, with their sub-items, into an archive section or note. | [task-archive](https://github.com/perezamadorluisenrique-gif/task-archive) |

All of them are in the community directory: Settings -> Community plugins ->
Browse, then search for the name.

## License

MIT
