# Task Graph

An Obsidian plugin that shows your tasks as **floating cards** in a force-directed graph,
clustered by life **area** and connected by shared **projects/people** and explicit
**dependencies**. It is the visual companion to the
[obsidian-second-brain](../second-brain-sho) skill.

The vault markdown is the only contract between the two. The skill writes task notes; the
plugin reads them and writes `status` back. No API, no server, fully portable.

## What it does

- Reads every note with `type: task` frontmatter (in the `Tasks/` folder by default).
- Renders each task as a draggable card: title, priority, area, due date, and a done toggle.
- **Clusters** cards by `area` (color-coded, with a legend).
- Draws **dependency arrows** for each `depends-on: ["[[Tasks/...]]"]`.
- Draws faint **association lines** between tasks that share a `related-projects` or
  `related-people` link.
- **Live sync**: re-renders automatically when the second brain (or you) creates or edits a
  task note.

## Write-back (MVP)

- **Toggle done**: click a card's circle to flip `status` between `in-progress` and `done`.
  This is written to the note's frontmatter via Obsidian's safe `processFrontMatter` API.
- **Reposition**: drag a card; the position is pinned and saved to the plugin's own
  `data.json` (keyed by note path), so notes stay clean and AI-first.

Everything else (creating tasks, editing links, dependencies, and areas) is done from the
chat with the second brain.

## Task frontmatter

```yaml
---
date: 2026-05-28
type: task
status: in-progress        # in-progress | done | waiting | cancelled
priority: "🔴"
area: professional         # god | self | family | service | professional | secular (free-form)
due: 2026-05-30
related-projects: ["[[Projects/Tide]]"]
related-people: ["[[People/Sam Patel]]"]
depends-on: ["[[Tasks/Write changelog]]"]
ai-first: true
---
```

## Develop / install locally

```bash
npm install
npm run build           # emits main.js (production)
# or: npm run dev        # watch mode

# Install into a vault for testing:
mkdir -p "<vault>/.obsidian/plugins/obsidian-task-graph"
ln -sf "$(pwd)/main.js"      "<vault>/.obsidian/plugins/obsidian-task-graph/main.js"
ln -sf "$(pwd)/manifest.json" "<vault>/.obsidian/plugins/obsidian-task-graph/manifest.json"
ln -sf "$(pwd)/styles.css"    "<vault>/.obsidian/plugins/obsidian-task-graph/styles.css"
```

Then enable **Task Graph** in Obsidian settings (Community plugins), and open it from the
ribbon (git-fork icon) or the command palette ("Open Task Graph").

## Controls

- **Drag a card**: move and pin it (position persists).
- **Click the circle**: toggle done.
- **Click the title**: open the task note (Cmd/Ctrl-click opens in a new pane).
- **Drag the background**: pan.
- **Scroll**: zoom.

## Settings

Tasks folder, task type, association edges on/off, hide completed, charge strength, cluster
strength, and per-area colors.

## License

MIT
