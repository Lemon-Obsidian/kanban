import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";
import { DEFAULT_SETTINGS, KanbanColumn, KanbanSettings } from "./types";
import { FileManager } from "./FileManager";
import { KanbanView, VIEW_TYPE_KANBAN } from "./KanbanView";
import { TagGroupView, VIEW_TYPE_TAG_GROUP } from "./TagGroupView";
import { slugify } from "./utils";

export default class KanbanPlugin extends Plugin {
  settings: KanbanSettings;
  fileManager: FileManager;

  private refreshTimeout: number | null = null;

  async onload() {
    await this.loadSettings();
    this.fileManager = new FileManager(this.app, this.settings);

    this.registerView(
      VIEW_TYPE_KANBAN,
      (leaf) => new KanbanView(leaf, this.fileManager, this.settings, () => this.saveSettings())
    );
    this.registerView(
      VIEW_TYPE_TAG_GROUP,
      (leaf) => new TagGroupView(leaf, this.fileManager, this.settings)
    );

    this.addRibbonIcon("columns", "Kanban 보드 열기", () =>
      this.activateView(VIEW_TYPE_KANBAN)
    );
    this.addRibbonIcon("tag", "태그별 보기 열기", () =>
      this.activateView(VIEW_TYPE_TAG_GROUP)
    );

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

    this.addSettingTab(new KanbanSettingTab(this.app, this));

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

  refreshAllViews() {
    const leaves = [
      ...this.app.workspace.getLeavesOfType(VIEW_TYPE_KANBAN),
      ...this.app.workspace.getLeavesOfType(VIEW_TYPE_TAG_GROUP),
    ];
    for (const leaf of leaves) {
      (leaf.view as KanbanView | TagGroupView).refresh();
    }
  }

  async loadSettings() {
    const saved = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      columns: saved?.columns ?? DEFAULT_SETTINGS.columns,
    };
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
  private newColName = "";
  private newColFlushable = false;

  constructor(app: App, private plugin: KanbanPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Kanban 설정" });

    // ── 보드 폴더 ──
    new Setting(containerEl)
      .setName("보드 폴더")
      .setDesc("카드 파일을 저장할 최상위 폴더 경로")
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

    // ── 컬럼 관리 ──
    containerEl.createEl("h3", { text: "컬럼 관리" });
    containerEl.createEl("p", {
      text: "컬럼 순서대로 보드에 표시됩니다. Flush 가능 컬럼은 보드에서 일괄 아카이브할 수 있습니다.",
      cls: "setting-item-description",
    });

    const cols = this.plugin.settings.columns;

    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      const setting = new Setting(containerEl)
        .setName(`컬럼 ${i + 1}`)
        .setDesc(`폴더: ${col.id}`);

      // 이름
      setting.addText((text) =>
        text.setValue(col.label).onChange(async (v) => {
          cols[i].label = v.trim() || col.id;
          await this.plugin.saveSettings();
          this.plugin.refreshAllViews();
        })
      );

      // Flush 가능 토글
      setting.addToggle((toggle) =>
        toggle
          .setTooltip("Flush 가능")
          .setValue(col.flushable ?? false)
          .onChange(async (v) => {
            cols[i].flushable = v;
            await this.plugin.saveSettings();
            this.plugin.refreshAllViews();
          })
      );

      // 위로
      setting.addButton((btn) =>
        btn
          .setIcon("arrow-up")
          .setTooltip("위로")
          .setDisabled(i === 0)
          .onClick(async () => {
            [cols[i - 1], cols[i]] = [cols[i], cols[i - 1]];
            await this.plugin.saveSettings();
            this.plugin.refreshAllViews();
            this.display();
          })
      );

      // 아래로
      setting.addButton((btn) =>
        btn
          .setIcon("arrow-down")
          .setTooltip("아래로")
          .setDisabled(i === cols.length - 1)
          .onClick(async () => {
            [cols[i], cols[i + 1]] = [cols[i + 1], cols[i]];
            await this.plugin.saveSettings();
            this.plugin.refreshAllViews();
            this.display();
          })
      );

      // 삭제
      setting.addButton((btn) =>
        btn
          .setIcon("trash")
          .setTooltip("컬럼 삭제")
          .onClick(async () => {
            if (cols.length <= 1) {
              new Notice("최소 1개의 컬럼이 필요합니다.");
              return;
            }
            const cards = await this.plugin.fileManager.loadCards(col.id);
            if (cards.length > 0) {
              new Notice(
                `"${col.label}" 컬럼에 카드가 ${cards.length}개 있습니다. 먼저 카드를 이동하거나 삭제하세요.`
              );
              return;
            }
            cols.splice(i, 1);
            await this.plugin.saveSettings();
            this.plugin.refreshAllViews();
            this.display();
          })
      );
    }

    // ── 새 컬럼 추가 ──
    containerEl.createEl("h4", { text: "새 컬럼 추가" });

    new Setting(containerEl)
      .setName("컬럼 이름")
      .addText((text) => {
        text
          .setPlaceholder("예: 리뷰, Backlog...")
          .setValue(this.newColName)
          .onChange((v) => (this.newColName = v));
        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") this.addColumn();
        });
      })
      .addButton((btn) =>
        btn.setButtonText("추가").setCta().onClick(() => this.addColumn())
      );

    new Setting(containerEl)
      .setName("Flush 가능")
      .setDesc("이 컬럼의 카드를 일괄 아카이브(Flush)할 수 있습니다")
      .addToggle((toggle) =>
        toggle
          .setValue(this.newColFlushable)
          .onChange((v) => (this.newColFlushable = v))
      );
  }

  private async addColumn() {
    const name = this.newColName.trim();
    if (!name) {
      new Notice("컬럼 이름을 입력하세요.");
      return;
    }

    const existingIds = this.plugin.settings.columns.map((c) => c.id);
    let id = slugify(name) || `col-${Date.now()}`;

    if (existingIds.includes(id)) {
      let n = 2;
      while (existingIds.includes(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }

    const newCol: KanbanColumn = { id, label: name, flushable: this.newColFlushable };
    this.plugin.settings.columns.push(newCol);
    await this.plugin.saveSettings();
    await this.plugin.fileManager.ensureFolders();
    this.plugin.refreshAllViews();

    this.newColName = "";
    this.newColFlushable = false;
    this.display();
    new Notice(`"${name}" 컬럼이 추가되었습니다.`);
  }
}
