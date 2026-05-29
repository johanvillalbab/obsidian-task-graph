import { App, TFile } from "obsidian";
import { isDoneStatus } from "./taskModel";

// Two status vocabularies show up in vaults: the canonical set
// (in-progress | done | waiting | cancelled) and a compact set
// (todo | in_progress | blocked | completed). Toggle within the note's own family
// so we never mix vocabularies on a given task.
const COMPACT_TERMS = new Set(["todo", "in_progress", "blocked", "completed"]);

function isCompactFamily(current: string): boolean {
  return COMPACT_TERMS.has(current.toLowerCase());
}

// Toggle a task between open and done, preserving its existing vocabulary.
export function nextToggleStatus(current: string): string {
  const compact = isCompactFamily(current);
  if (isDoneStatus(current)) return compact ? "todo" : "in-progress";
  return compact ? "completed" : "done";
}

// Local-time YYYY-MM-DD, matching the vault's `date` convention.
function today(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Write the new status into the note's frontmatter, plus AI-first completion markers:
//  - completing stamps `completed_date` so future-Claude knows WHEN it was closed
//  - reopening clears `completed_date`
//  - either way, `updated` is bumped to today
// This is the only thing the plugin writes back. Card positions live in the plugin's
// own data.json, so notes stay clean. `processFrontMatter` is Obsidian's safe editor.
export async function setStatus(app: App, file: TFile, status: string): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.status = status;
    fm.updated = today();
    if (isDoneStatus(status)) {
      fm.completed_date = today();
    } else if ("completed_date" in fm) {
      delete fm.completed_date;
    }
  });
}
