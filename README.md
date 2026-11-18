# Now & Next

A gentle day, week and month planner for [Obsidian](https://obsidian.md), built on the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin and designed with ADHD and autistic brains in mind.

Your tasks stay where they are: ordinary Tasks lines in your notes. Now & Next is a way of looking at them, planning them across days and getting through them, one thing at a time.

## What it does

- **Day, week and month views.** Week is the default; zoom in to one day or out to the month with the buttons or `Cmd/Ctrl` `+` and `-`.
- **Plan by dragging.** Drag a task onto a day to schedule it (it gets a `⏳` scheduled date). Drag it onto a tab to take it off its day again.
- **Areas.** Each subfolder of your areas folder gets a tab, along with any task tagged with that folder's name (for example `#health`). Add a folder and a new tab appears.
- **Priorities.** Undated tasks marked 🔺 or ⏫ wait in their own tab. Set priority from any task's menu.
- **Today in the sidebar.** A compact Today view sits in the left sidebar next to Files, Search and Bookmarks. The ribbon icon opens the full planner.
- **Sub-tasks.** Indented tasks show under their parent and can be ticked off on their own.
- **Stats.** This week's percentage done, the average over the last four weeks, and a streak of weeks with at least one task done.

Ticking a task goes through the Tasks plugin, so done dates and repeating tasks behave exactly as they do in Tasks itself.

## Supports

Each support can be switched on or off in **Settings → Now & Next → Supports**. All are on to start.

| Support | What it does |
|---|---|
| Focus mode | Shows today only: one task as **Now**, the following one as **Next**. Done, Not now, a timer and a first-step prompt sit under the current task. |
| Daily cap | Set how many tasks you want on one day. A day over the cap says so quietly and offers to move the extras on to the next day. |
| Gentle carry-over | Nothing turns red. Unfinished tasks from past days wait in a "Carry over?" tray: move each to today, tomorrow or another day, put it back in its list, or let it go. With this off, they show on today instead. |
| Quick capture | A capture box that drops a thought into today's daily note as a task, so ideas get parked without a context switch. |
| Done list | Each day shows what you finished, not only what's left. |
| Energy tags | Tag tasks `#energy/low`, `#energy/mid` or `#energy/high`, then filter the planner to what fits how you feel right now. |
| Visible time | A bar showing how much of your working day is left. |
| Task timer | Start a countdown on a task. It shows in the status bar and chimes at the end. No log, no score. |
| Time estimates | Add an estimate such as `[est:: 30m]`. Each day totals its estimates against your working hours, so overload shows before it happens. |
| First tiny step | A task with no sub-tasks that has sat for a while gets a quiet "first step?" prompt. Your answer becomes a sub-task. |
| Waiting-on status | Mark a task as waiting on someone (`[w]`). It leaves the day's list for a separate "Waiting on others" strip. |
| Weekly review | A short guided review: what you finished, what to carry over or drop, and up to three priorities for next week. |
| Calm view switch | Hides dates, emojis, counts and stats, leaving task text and checkboxes. |
| Talk it through | Opens the Claudian chat so you can dictate tasks (see below). |

## Task format

Now & Next reads and writes the Tasks plugin's emoji format. Everything it adds is plain text you can also type by hand.

```markdown
- [ ] Book dentist [est:: 30m] ⏫ ⏳ 2026-11-24 📅 2026-11-28 #health #energy/low
	- [ ] Find the clinic's number
- [w] Hear back from the landlord
```

| Part | Meaning |
|---|---|
| `⏳ date` | The day the task sits on. A task with only a `📅` due date sits on its due date. |
| `🔺 ⏫ 🔼 🔽 ⏬` | Priority, highest to lowest. |
| `#<area>` | Puts the task in that area's tab. Tasks inside an area's folder belong there already. |
| `#energy/low`, `#energy/mid`, `#energy/high` | Energy needed. |
| `[est:: 30m]` | Time estimate (`30m`, `1h`, `1h30m`). It goes before the emoji fields so Tasks still reads them. |
| `[w]` | Waiting on someone. |

New tasks go into today's daily note, using the folder and date format from Obsidian's Daily notes settings. A task captured in a daily note with an area tag shows under that area; an untagged one shows under the daily notes' own tab, ready to be planned or sorted.

## Requirements

- Obsidian 1.7.2 or later.
- The [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin, for ticking tasks off with done dates and repeats.
- Obsidian's core **Daily notes** plugin, for where new tasks go.
- For the Waiting-on status, a custom status in Tasks settings: symbol `w`, name `Waiting`, type `ON_HOLD`.

## Install

Now & Next is not yet in the community plugin list. To install it by hand:

1. Build `main.js` (see Development), or download `main.js`, `manifest.json` and `styles.css` from a release once one is published.
2. Put the three files in `<your vault>/.obsidian/plugins/now-and-next/`.
3. Reload Obsidian and turn on **Now & Next** in **Settings → Community plugins**.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Areas folder | `domains` | Each subfolder becomes a tab. If you rename or move the folder inside Obsidian, the setting follows it. |
| Folders to ignore | `systems/templates` | Tasks in these folders (for example templates) are left out. |
| Daily cap | 5 | |
| Working day | 09:00 to 17:00 | Used for the time-left bar and estimate totals. |
| Timer length | 25 minutes | |
| First-step prompt after | 5 days | |
| Show weekend | Off | |
| Open at | Week | |
| Calm view | Off | |

## Talk it through (optional)

The **Talk it through** button opens the chat of the Claudian community plugin, which runs Claude in your vault. Dictate a brain dump (on macOS, press `fn` twice), and Claude writes the tasks into today's daily note in the format above. The planner picks them up straight away.

For good results, put the task format rules in a `CLAUDE.md` file at the root of your vault, so Claude knows which fields to use and where to write. Claudian is desktop only and needs its own setup.

## Commands

Open planner · Show today in sidebar · Focus mode · Capture a thought to today's note · Weekly review · Talk it through · Stop timer · Toggle calm view

## Development

```bash
npm install
npm run build                # type-check and bundle to main.js
node --test test/*.test.ts   # task-line parser tests (Node 23.6 or later)
```

The task-line parser in `src/tasks.ts` has no Obsidian imports, so it can be tested with plain Node.

## Licence

[MIT](LICENSE) © 2026 l0wtalker
