import { debounce, ItemView, WorkspaceLeaf } from "obsidian";
import { GraphRenderer } from "./graph";
import type TaskGraphPlugin from "./main";
import { buildModel, TaskNode } from "./taskModel";
import { nextToggleStatus, setStatus } from "./writeback";

export const VIEW_TYPE_TASK_GRAPH = "task-graph-view";

export class TaskGraphView extends ItemView {
  private plugin: TaskGraphPlugin;
  private renderer: GraphRenderer | null = null;

  // Debounced rebuild so a burst of vault writes (e.g. the second brain editing
  // several notes) collapses into a single re-render.
  private scheduleRefresh = debounce(() => this.refresh(), 300, true);

  constructor(leaf: WorkspaceLeaf, plugin: TaskGraphPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_TASK_GRAPH;
  }

  getDisplayText(): string {
    return "Task Graph";
  }

  getIcon(): string {
    return "git-fork";
  }

  async onOpen(): Promise<void> {
    const host = this.contentEl;
    host.empty();
    host.addClass("tg-host");

    this.buildToolbar(host);
    const graphHost = host.createDiv({ cls: "tg-graph-host" });

    this.renderer = new GraphRenderer(graphHost, this.plugin.settings, {
      onToggleStatus: (node) => this.handleToggle(node),
      onOpenNote: (node, newLeaf) => {
        this.app.workspace.getLeaf(newLeaf).openFile(node.file);
      },
      onPositionChange: (id, x, y) => this.plugin.setSavedPosition(id, x, y),
      getSavedPosition: (id) => this.plugin.getSavedPosition(id),
    });

    this.refresh();

    // Live sync: rebuild when task notes are created, edited, or removed by anyone
    // (the second brain in the chat, Obsidian itself, or this plugin's own writes).
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
  }

  async onClose(): Promise<void> {
    this.renderer?.destroy();
    this.renderer = null;
  }

  private buildToolbar(host: HTMLElement): void {
    const bar = host.createDiv({ cls: "tg-toolbar" });

    bar.createSpan({ cls: "tg-toolbar-label", text: "Group by" });
    const select = bar.createEl("select", { cls: "dropdown tg-groupby" });
    const options: Array<[string, string]> = [
      ["auto", "Auto"],
      ["project", "Project"],
      ["area", "Area"],
      ["tag", "Tag"],
    ];
    for (const [value, label] of options) {
      const opt = select.createEl("option", { text: label });
      opt.value = value;
    }
    select.value = this.plugin.settings.groupBy;
    select.addEventListener("change", async () => {
      this.plugin.settings.groupBy = select.value as typeof this.plugin.settings.groupBy;
      await this.plugin.saveSettings();
      this.refresh();
    });

    bar.createSpan({ cls: "tg-toolbar-label", text: "Layout" });
    const layoutSelect = bar.createEl("select", { cls: "dropdown tg-layout" });
    const layouts: Array<[string, string]> = [
      ["force", "Force (floating)"],
      ["grid", "Grid (rows)"],
    ];
    for (const [value, label] of layouts) {
      const opt = layoutSelect.createEl("option", { text: label });
      opt.value = value;
    }
    layoutSelect.value = this.plugin.settings.layout;
    layoutSelect.addEventListener("change", async () => {
      this.plugin.settings.layout = layoutSelect.value as typeof this.plugin.settings.layout;
      await this.plugin.saveSettings();
      this.renderer?.resetCamera();
      this.refresh();
    });

    const relayout = bar.createEl("button", { cls: "tg-relayout", text: "Re-layout" });
    relayout.setAttribute("aria-label", "Clear saved positions and re-cluster by group");
    relayout.addEventListener("click", () => {
      this.plugin.clearPositions();
      this.renderer?.resetCamera();
      this.refresh();
    });
  }

  refresh(): void {
    if (!this.renderer) return;
    const model = buildModel(this.app, this.plugin.settings);
    // Preserve the camera across refreshes so a status toggle doesn't yank the view.
    const camera = this.renderer.getCamera();
    const hasCamera = camera.panX !== 0 || camera.panY !== 0 || camera.scale !== 1;
    this.renderer.render(model, hasCamera ? camera : undefined);
  }

  private async handleToggle(node: TaskNode): Promise<void> {
    const next = nextToggleStatus(node.status);
    await setStatus(this.app, node.file, next);
    // The metadataCache "changed" event will trigger scheduleRefresh and repaint.
  }
}
