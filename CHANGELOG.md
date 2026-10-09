# Changelog

The release workflow uses the section named after the version being released
as the release description, so every version needs one. `npm version <x.y.z>`
renames the `Unreleased` heading below to that version.

## 0.2.0

- New command "Gather unfinished tasks from past daily notes…": pick the last 7, 30 or 90 days or all of them, review the unfinished tasks grouped by note, untick any, and move the rest into today's note in one go. Identical tasks are listed once, from the newest note.
- "Undo the last rollover" undoes a whole gather in one step.

## 0.1.1

- Type the date helper this plugin uses, so the directory review no longer reports unsafe calls. No change in behavior.

## 0.1.0

- First release.
