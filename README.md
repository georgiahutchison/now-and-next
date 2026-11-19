# Now & Next

A day, week and month planner for [Obsidian](https://obsidian.md), built on the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin and designed with ADHD and autistic brains in mind.

Your tasks stay where they are: ordinary Tasks lines in your notes. Now & Next is a way of looking at them, planning them across days and getting through them, one thing at a time.

## What it does

- **Views: Focus, Day, Week, Month and Triage.** Week is the default. `Cmd/Ctrl` `+` and `-` zoom between Day, Week and Month.
- **Triage.** Four boxes by importance (🔺 or ⏫) and urgency (a deadline within 7 days, or `#urgent`): Do, Plan, Quick, Not now. Dragging a task between boxes sets or clears ⏫ and `#urgent`; deadlines are left as they are.
- **Later.** A panel at the base, closed by default, for tasks tagged `#later` or deferred to a later month (a future `🛫` start date). They stay out of the area tabs until then.
- **Plan by dragging.** Drag a task onto a day to schedule it (it gets a `⏳` scheduled date). Drag it onto a tab to take it off its day again.
- **Areas.** Each subfolder of your areas folder gets a tab, along with any task tagged with that folder's name (for example `#health`). Add a folder and a new tab appears.
- **Priorities.** Undated tasks marked 🔺 or ⏫ wait in their own tab. Set priority from any task's menu.
- **Today in the sidebar.** A compact Today view sits in the left sidebar next to Files, Search and Bookmarks. The ribbon icon opens the full planner.
- **Details.** Plain bullets indented under a task show in small text under it. Indented checkbox tasks are shown as tasks in their own right.

Ticking a task goes through the Tasks plugin, so done dates and repeating tasks behave exactly as they do in Tasks itself.

## Supports

Each support can be switched on or off in **Settings → Now & Next → Supports**. All are on to start.

| Support | What it does |
|---|---|
| Focus mode | The Focus view shows today only: one task as **Now**, the following one as **Next**. Done, Not now, a timer and a first-step prompt sit under the current task. |
| Daily cap | Set how many tasks you want on one day. A day over the cap says so quietly and offers to move the extras on to the next day. |
| Carry-over tray | Unfinished tasks from past days wait in a "Carry over?" tray: move each to today, tomorrow or another day, put it back in its list, or let it go. With this off, they show on today instead. |
| Quick capture | A capture box that drops a thought into today's daily note as a task, so ideas get parked without a context switch. |
| Done list | Each day shows what you finished, not only what's left. |
| Energy tags | Tag tasks `#energy/low`, `#energy/mid` or `#energy/high`, then filter the planner to what fits how you feel right now. |
| Task timer | Start a countdown on a task. It shows in the status bar and chimes at the end. |
| Time estimates | Add an estimate such as `[est:: 30m]`. Each day totals its estimates against your working hours, so overload shows before it happens. |
| First tiny step | A task with no sub-tasks that has sat for a while gets a "first step?" prompt. Your answer is added as an indented task under it. |
| Waiting-on status | Mark a task as waiting on someone (`[w]`). It leaves the day's list for a separate "Waiting on others" strip. |

## Task format

Now & Next reads and writes the Tasks plugin's emoji format. Everything it adds is plain text you can also type by hand.

```markdown
- [ ] Book dentist [est:: 30m] ⏫ ⏳ 2026-11-24 📅 2026-11-28 #health #energy/low
	- Ask about weekend appointments
- [w] Hear back from the landlord
```

| Part | Meaning |
|---|---|
| `⏳ date` | The day the task sits on. A task with only a `📅` due date sits on its due date. |
| `🔺 ⏫ 🔼 🔽 ⏬` | Priority, highest to lowest. |
| `#<area>` | Puts the task in that area's tab. Tasks inside an area's folder belong there already. Area names with spaces become hyphenated tags (`pro practice` → `#pro-practice`). Dropping a task on an area tab moves it there. |
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
| Working day | 09:00 to 17:00 | Used for estimate totals. |
| Timer length | 25 minutes | |
| First-step prompt after | 5 days | |
| Show weekend | Off | |
| Open at | Week | |
| Ideas note | `Now & Next ideas.md` | Where "Add a plugin idea" writes. |


## Commands

Open planner · Show today in sidebar · Focus mode · Capture a thought to today's note · Add a plugin idea · Show the emoji key · Stop timer

## Development

```bash
npm install
npm run build                # type-check and bundle to main.js
node --test test/*.test.ts   # task-line parser tests (Node 23.6 or later)
```

The task-line parser in `src/tasks.ts` has no Obsidian imports, so it can be tested with plain Node.

## Licence

[MIT](LICENSE) © 2026 l0wtalker
