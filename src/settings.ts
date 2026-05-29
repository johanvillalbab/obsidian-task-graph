import { App, PluginSettingTab, Setting } from "obsidian";
import type TaskGraphPlugin from "./main";

export type GroupBy = "auto" | "area" | "project" | "tag";
export type LayoutMode = "force" | "grid";

export interface TaskGraphSettings {
  // Folder (vault-relative) to scan for task notes. Empty string = whole vault.
  tasksFolder: string;
  // Frontmatter value of `type` that marks a note as a task.
  taskType: string;
  // Which frontmatter dimension to cluster + color cards by.
  groupBy: GroupBy;
  // How cards are arranged: free-floating force graph, or a tidy grid by group.
  layout: LayoutMode;
  // Explicit area -> color overrides. Unknown areas get an auto-assigned palette color.
  areaColors: Record<string, string>;
  // Draw faint lines between tasks that share a project or person.
  showAssociationEdges: boolean;
  // Hide cards whose status is done/cancelled.
  hideCompleted: boolean;
  // Force simulation tuning.
  linkDistance: number;
  chargeStrength: number;
  clusterStrength: number;
}

export const DEFAULT_SETTINGS: TaskGraphSettings = {
  tasksFolder: "",
  taskType: "task",
  groupBy: "auto",
  layout: "force",
  areaColors: {
    god: "#a78bfa",
    self: "#34d399",
    family: "#f59e0b",
    service: "#60a5fa",
    professional: "#f472b6",
    secular: "#94a3b8",
  },
  showAssociationEdges: true,
  hideCompleted: false,
  linkDistance: 120,
  chargeStrength: -380,
  clusterStrength: 0.12,
};

// Deterministic fallback palette for areas with no explicit color.
const FALLBACK_PALETTE = [
  "#60a5fa", "#34d399", "#f59e0b", "#f472b6", "#a78bfa",
  "#22d3ee", "#fb7185", "#a3e635", "#fbbf24", "#818cf8",
];

export function colorForArea(settings: TaskGraphSettings, area: string): string {
  const key = (area || "uncategorized").toLowerCase();
  if (settings.areaColors[key]) return settings.areaColors[key];
  // Stable hash so the same area always maps to the same palette slot.
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % FALLBACK_PALETTE.length;
  return FALLBACK_PALETTE[idx];
}

export class TaskGraphSettingTab extends PluginSettingTab {
  plugin: TaskGraphPlugin;

  constructor(app: App, plugin: TaskGraphPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Tasks folder")
      .setDesc("Vault-relative folder to scan for task notes. Leave empty to scan the whole vault (recommended).")
      .addText((t) =>
        t
          .setPlaceholder("(whole vault)")
          .setValue(this.plugin.settings.tasksFolder)
          .onChange(async (v) => {
            this.plugin.settings.tasksFolder = v.trim();
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

    new Setting(containerEl)
      .setName("Group cards by")
      .setDesc("Which dimension clusters and colors the cards. Auto = area, then project, then tag.")
      .addDropdown((d) =>
        d
          .addOptions({
            auto: "Auto (smart)",
            project: "Project (related-projects)",
            area: "Area (area field)",
            tag: "Tag (first non-task tag)",
          })
          .setValue(this.plugin.settings.groupBy)
          .onChange(async (v) => {
            this.plugin.settings.groupBy = v as TaskGraphSettings["groupBy"];
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

    new Setting(containerEl)
      .setName("Task type")
      .setDesc('Frontmatter value of `type:` that marks a note as a task.')
      .addText((t) =>
        t
          .setValue(this.plugin.settings.taskType)
          .onChange(async (v) => {
            this.plugin.settings.taskType = v.trim() || "task";
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

    new Setting(containerEl)
      .setName("Show association edges")
      .setDesc("Draw faint lines between tasks that share a project or person.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showAssociationEdges).onChange(async (v) => {
          this.plugin.settings.showAssociationEdges = v;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        })
      );

    new Setting(containerEl)
      .setName("Hide completed tasks")
      .setDesc("Hide cards whose status is done or cancelled.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.hideCompleted).onChange(async (v) => {
          this.plugin.settings.hideCompleted = v;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        })
      );

    new Setting(containerEl)
      .setName("Charge strength")
      .setDesc("How strongly cards repel each other. More negative = more spread out.")
      .addSlider((s) =>
        s
          .setLimits(-800, -50, 10)
          .setValue(this.plugin.settings.chargeStrength)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.chargeStrength = v;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

    new Setting(containerEl)
      .setName("Cluster strength")
      .setDesc("How strongly cards are pulled toward their area cluster.")
      .addSlider((s) =>
        s
          .setLimits(0, 0.5, 0.01)
          .setValue(this.plugin.settings.clusterStrength)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.clusterStrength = v;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );
  }
}
