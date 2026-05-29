import { App, TFile } from "obsidian";
import type { TaskGraphSettings } from "./settings";

export type TaskStatus = "in-progress" | "done" | "waiting" | "cancelled" | string;

export interface TaskNode {
  id: string; // file path, stable identity
  file: TFile;
  title: string;
  status: TaskStatus;
  done: boolean; // normalized completion flag across vocabularies
  priority: string; // raw emoji or label, may be empty
  group: string; // category used for clustering + color (display case preserved)
  due: string | null;
  projects: string[]; // resolved file paths (or raw linkpath if unresolved)
  people: string[];
  dependsOn: string[]; // resolved task paths this task is blocked by
}

export type EdgeKind = "dependency" | "association";

export interface TaskEdge {
  source: string; // task path
  target: string; // task path
  kind: EdgeKind;
  // For association edges, what they share (project/person name) — used for tooltips.
  reason?: string;
}

export interface TaskModel {
  nodes: TaskNode[];
  edges: TaskEdge[];
  groups: string[]; // distinct groups/categories, sorted
}

// A status counts as "done" across both the canonical (done/cancelled) and the
// lifeos-era (completed) vocabularies.
const DONE_STATUSES = new Set(["done", "completed", "cancelled"]);
export function isDoneStatus(status: string): boolean {
  return DONE_STATUSES.has(status.toLowerCase());
}

function asArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((v) => String(v));
  return [String(value)];
}

// Strip [[Path|Alias]] / [[Path]] / "Path" down to the link target path-ish string.
function rawLinkTarget(raw: string): string {
  const m = raw.match(/\[\[([^\]]+)\]\]/);
  const inner = m ? m[1] : raw;
  return inner.split("|")[0].trim();
}

function isTask(app: App, file: TFile, settings: TaskGraphSettings): boolean {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!fm) return false;
  return String(fm.type ?? "").toLowerCase() === settings.taskType.toLowerCase();
}

function inScope(file: TFile, settings: TaskGraphSettings): boolean {
  const folder = settings.tasksFolder.replace(/\/+$/, "");
  if (!folder) return true;
  return file.path === folder || file.path.startsWith(folder + "/");
}

// Resolve a frontmatter link value to a vault file path, falling back to the raw target.
function resolveLink(app: App, raw: string, sourcePath: string): string {
  const target = rawLinkTarget(raw);
  const dest = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
  return dest ? dest.path : target;
}

// Prefer the explicit frontmatter `title`, then a real H1 heading, then the filename.
// Never the `## For future Claude/AI` preamble (it is an H2 and not a title).
function titleFor(app: App, file: TFile, fm: Record<string, unknown>): string {
  const fmTitle = fm.title ? String(fm.title).trim() : "";
  if (fmTitle) return fmTitle;
  const headings = app.metadataCache.getFileCache(file)?.headings ?? [];
  const h1 = headings.find((h) => h.level === 1);
  if (h1) return h1.heading;
  return file.basename;
}

function firstLink(values: string[]): string {
  if (values.length === 0) return "";
  return rawLinkTarget(values[0]).split("/").pop() || "";
}

function firstMeaningfulTag(tags: string[]): string {
  for (const t of tags) {
    const clean = t.replace(/^#/, "");
    if (clean && clean.toLowerCase() !== "task") return clean;
  }
  return "";
}

// Resolve which category a task belongs to, per the configured grouping dimension.
function resolveGroup(fm: Record<string, unknown>, settings: TaskGraphSettings): string {
  const area = fm.area ? String(fm.area).trim() : "";
  const project = firstLink(asArray(fm["related-projects"]));
  const tag = firstMeaningfulTag(asArray(fm.tags));

  switch (settings.groupBy) {
    case "area":
      return area || "uncategorized";
    case "project":
      return project || "uncategorized";
    case "tag":
      return tag || "uncategorized";
    case "auto":
    default:
      // Smart default: prefer the explicit area, then the project (finest useful
      // grouping for most vaults), then a tag.
      return area || project || tag || "uncategorized";
  }
}

export function buildModel(app: App, settings: TaskGraphSettings): TaskModel {
  const files = app.vault.getMarkdownFiles().filter((f) => inScope(f, settings) && isTask(app, f, settings));

  const nodes: TaskNode[] = [];
  const byPath = new Map<string, TaskNode>();

  for (const file of files) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const status = String(fm.status ?? "in-progress");
    const done = isDoneStatus(status) || fm.completed_date != null || fm.completed === true;
    if (settings.hideCompleted && done) continue;

    const node: TaskNode = {
      id: file.path,
      file,
      title: titleFor(app, file, fm),
      status,
      done,
      priority: String(fm.priority ?? ""),
      group: resolveGroup(fm, settings),
      due: fm.due ? String(fm.due) : fm.due_date ? String(fm.due_date) : null,
      projects: asArray(fm["related-projects"]).map((r) => resolveLink(app, r, file.path)),
      people: asArray(fm["related-people"]).map((r) => resolveLink(app, r, file.path)),
      dependsOn: asArray(fm["depends-on"]).map((r) => resolveLink(app, r, file.path)),
    };
    nodes.push(node);
    byPath.set(node.id, node);
  }

  const edges: TaskEdge[] = [];
  const seen = new Set<string>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}::${b}` : `${b}::${a}`);

  // Dependency edges (directed). Only when the target is also a task node.
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!byPath.has(dep) || dep === node.id) continue;
      const key = `dep:${node.id}->${dep}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: node.id, target: dep, kind: "dependency" });
    }
  }

  // Association edges (undirected) for tasks sharing a project or person.
  if (settings.showAssociationEdges) {
    const groups = new Map<string, string[]>(); // shared entity -> task paths
    const addToGroup = (entity: string, taskId: string) => {
      const arr = groups.get(entity) ?? [];
      arr.push(taskId);
      groups.set(entity, arr);
    };
    for (const node of nodes) {
      for (const p of node.projects) addToGroup("project:" + p, node.id);
      for (const p of node.people) addToGroup("person:" + p, node.id);
    }
    for (const [entity, members] of groups) {
      if (members.length < 2) continue;
      const reason = entity.replace(/^project:|^person:/, "");
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = members[i];
          const b = members[j];
          const key = pairKey(a, b);
          // Don't duplicate a dependency edge with a faint association edge.
          if (seen.has(`dep:${a}->${b}`) || seen.has(`dep:${b}->${a}`)) continue;
          if (seen.has("assoc:" + key)) continue;
          seen.add("assoc:" + key);
          edges.push({ source: a, target: b, kind: "association", reason });
        }
      }
    }
  }

  const groups = Array.from(new Set(nodes.map((n) => n.group))).sort();
  return { nodes, edges, groups };
}
