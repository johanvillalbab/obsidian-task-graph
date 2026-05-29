import { debounce, Plugin, WorkspaceLeaf } from "obsidian";
import {
  DEFAULT_SETTINGS,
  TaskGraphSettings,
  TaskGraphSettingTab,
} from "./settings";
import { TaskGraphView, VIEW_TYPE_TASK_GRAPH } from "./TaskGraphView";

interface PersistedData {
  settings: TaskGraphSettings;
  // Manually-placed card positions, keyed by task note path.
  positions: Record<string, { x: number; y: number }>;
}

export default class TaskGraphPlugin extends Plugin {
  settings!: TaskGraphSettings;
  positions: Record<string, { x: number; y: number }> = {};

  private persist = debounce(() => this.saveData(this.snapshot()), 400, true);

  async onload(): Promise<void> {
    await this.loadPersisted();

    this.registerView(VIEW_TYPE_TASK_GRAPH, (leaf) => new TaskGraphView(leaf, this));

    this.addRibbonIcon("git-fork", "Open Task Graph", () => this.activateView());

    this.addCommand({
      id: "open-task-graph",
      name: "Open Task Graph",
      callback: () => this.activateView(),
    });

    this.addSettingTab(new TaskGraphSettingTab(this.app, this));

    // Keep manual positions attached to notes that get renamed.
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (this.positions[oldPath]) {
          this.positions[file.path] = this.positions[oldPath];
          delete this.positions[oldPath];
          this.persist();
        }
      })
    );
  }

  async onunload(): Promise<void> {
    // Leaves are detached automatically by Obsidian on plugin unload.
  }

  // ---- persistence ---------------------------------------------------------

  private snapshot(): PersistedData {
    return { settings: this.settings, positions: this.positions };
  }

  private async loadPersisted(): Promise<void> {
    const data = (await this.loadData()) as Partial<PersistedData> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? {});
    this.positions = data?.positions ?? {};
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.snapshot());
  }

  getSavedPosition(id: string): { x: number; y: number } | null {
    return this.positions[id] ?? null;
  }

  setSavedPosition(id: string, x: number, y: number): void {
    this.positions[id] = { x, y };
    this.persist();
  }

  // Drop all manual positions so the next render re-clusters everything by group.
  clearPositions(): void {
    this.positions = {};
    this.persist();
  }

  // ---- view management -----------------------------------------------------

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_GRAPH)) {
      const view = leaf.view;
      if (view instanceof TaskGraphView) view.refresh();
    }
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_GRAPH);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf: WorkspaceLeaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_TASK_GRAPH, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
}
