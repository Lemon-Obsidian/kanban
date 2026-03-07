import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";
import { DEFAULT_SETTINGS, KanbanSettings } from "./types";
import { FileManager } from "./FileManager";
import { KanbanView, VIEW_TYPE_KANBAN } from "./KanbanView";
import { TagGroupView, VIEW_TYPE_TAG_GROUP } from "./TagGroupView";

export default class KanbanPlugin extends Plugin {
  settings: KanbanSettings;
  fileManager: FileManager;

  private refreshTimeout: number | null = null;

  async onload() {
    await this.loadSettings();
    this.fileManager = new FileManager(this.app, this.settings);

    // Register views
    this.registerView(
      VIEW_TYPE_KANBAN,
      (leaf) => new KanbanView(leaf, this.fileManager, this.settings)
    );
    this.registerView(
      VIEW_TYPE_TAG_GROUP,
      (leaf) => new TagGroupView(leaf, this.fileManager, this.settings)
    );

    // Ribbon icons
    this.addRibbonIcon("layout-kanban", "Kanban 보드 열기", () =>
      this.activateView(VIEW_TYPE_KANBAN)
    );
    this.addRibbonIcon("tag", "태그별 보기 열기", () =>
      this.activateView(VIEW_TYPE_TAG_GROUP)
    );

    // Commands
    this.addCommand({
      id: "open-kanban-board",
      name: "Kanban 보드 열기",
      callback: () => this.activateView(VIEW_TYPE_KANBAN),
    });
    this.addCommand({
      id: "open-tag-group",
      name: "태그별 보기 열기",
      callback: () => this.activateView(VIEW_TYPE_TAG_GROUP),
    });

    // Settings tab
    this.addSettingTab(new KanbanSettingTab(this.app, this));

    // Refresh views on vault changes (debounced)
    const scheduleRefresh = () => {
      if (this.refreshTimeout) window.clearTimeout(this.refreshTimeout);
      this.refreshTimeout = window.setTimeout(() => {
        this.refreshAllViews();
        this.refreshTimeout = null;
      }, 400);
    };

    this.registerEvent(this.app.vault.on("create", scheduleRefresh));
    this.registerEvent(this.app.vault.on("delete", scheduleRefresh));
    this.registerEvent(this.app.vault.on("rename", scheduleRefresh));
    this.registerEvent(this.app.vault.on("modify", scheduleRefresh));
  }

  async activateView(viewType: string) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(viewType)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: viewType, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  private refreshAllViews() {
    const leaves = [
      ...this.app.workspace.getLeavesOfType(VIEW_TYPE_KANBAN),
      ...this.app.workspace.getLeavesOfType(VIEW_TYPE_TAG_GROUP),
    ];
    for (const leaf of leaves) {
      (leaf.view as KanbanView | TagGroupView).refresh();
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_KANBAN);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TAG_GROUP);
  }
}

class KanbanSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: KanbanPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Kanban 설정" });

    new Setting(containerEl)
      .setName("보드 폴더")
      .setDesc(
        "칸반 카드를 저장할 폴더 경로. 하위에 todo/, doing/, done/ 폴더가 자동 생성됩니다."
      )
      .addText((text) =>
        text
          .setPlaceholder("Kanban")
          .setValue(this.plugin.settings.boardFolder)
          .onChange(async (value) => {
            this.plugin.settings.boardFolder = value.trim() || "Kanban";
            await this.plugin.saveSettings();
            this.plugin.fileManager = new FileManager(
              this.app,
              this.plugin.settings
            );
          })
      );
  }
}
