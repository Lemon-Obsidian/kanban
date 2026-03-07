import {
  App,
  Modal,
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
      upcomingDays: saved?.upcomingDays ?? DEFAULT_SETTINGS.upcomingDays,
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
  private newDayValue = "";

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
      text: "컬럼 순서대로 보드에 표시됩니다. 보관 가능 컬럼은 보드에서 카드를 일괄 아카이브로 보관할 수 있습니다.",
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

      // 보관 가능 토글
      setting.addToggle((toggle) =>
        toggle
          .setTooltip("보관 가능")
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
            const cardCount = cards.length;
            const message = cardCount > 0
              ? `"${col.label}" 컬럼과 카드 ${cardCount}개가 모두 삭제됩니다. 계속하시겠습니까?`
              : `"${col.label}" 컬럼을 삭제할까요?`;
            new SettingConfirmModal(this.app, {
              title: "컬럼 삭제",
              message,
              confirmText: "삭제",
              onConfirm: async () => {
                await this.plugin.fileManager.deleteColumn(col.id);
                cols.splice(i, 1);
                await this.plugin.saveSettings();
                this.plugin.refreshAllViews();
                this.display();
              },
            }).open();
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
      .setName("보관 가능")
      .setDesc("이 컬럼의 카드를 일괄 아카이브로 보관할 수 있습니다")
      .addToggle((toggle) =>
        toggle
          .setValue(this.newColFlushable)
          .onChange((v) => (this.newColFlushable = v))
      );

    // ── 마감 임박 설정 ──
    containerEl.createEl("h3", { text: "마감 임박 설정" });
    containerEl.createEl("p", {
      text: "마감 임박 뷰에서 사용할 기간(일) 목록입니다. 각 값은 필터 버튼으로 표시됩니다.",
      cls: "setting-item-description",
    });

    const days = this.plugin.settings.upcomingDays;
    for (let i = 0; i < days.length; i++) {
      new Setting(containerEl)
        .setName(`${days[i]}일`)
        .addButton((btn) =>
          btn.setIcon("trash").setTooltip("삭제").onClick(async () => {
            days.splice(i, 1);
            await this.plugin.saveSettings();
            this.plugin.refreshAllViews();
            this.display();
          })
        );
    }

    containerEl.createEl("h4", { text: "기간 추가" });
    new Setting(containerEl)
      .setName("일 수")
      .setDesc("양의 정수를 입력하세요 (예: 14)")
      .addText((text) => {
        text
          .setPlaceholder("예: 14")
          .setValue(this.newDayValue)
          .onChange((v) => (this.newDayValue = v));
        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") this.addDay();
        });
      })
      .addButton((btn) =>
        btn.setButtonText("추가").setCta().onClick(() => this.addDay())
      );
  }

  private async addDay() {
    const n = parseInt(this.newDayValue.trim(), 10);
    if (!n || n <= 0) {
      new Notice("양의 정수를 입력하세요.");
      return;
    }
    const days = this.plugin.settings.upcomingDays;
    if (days.includes(n)) {
      new Notice("이미 추가된 값입니다.");
      return;
    }
    days.push(n);
    days.sort((a, b) => a - b);
    await this.plugin.saveSettings();
    this.plugin.refreshAllViews();
    this.newDayValue = "";
    this.display();
    new Notice(`${n}일이 추가되었습니다.`);
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

class SettingConfirmModal extends Modal {
  constructor(
    app: App,
    private opts: {
      title: string;
      message: string;
      confirmText: string;
      onConfirm: () => void;
    }
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.opts.title });
    contentEl.createEl("p", { text: this.opts.message });
    const btnRow = contentEl.createDiv({ cls: "kanban-modal-buttons" });
    btnRow.createEl("button", { text: "취소" }).addEventListener("click", () => this.close());
    const confirmBtn = btnRow.createEl("button", { text: this.opts.confirmText, cls: "mod-warning" });
    confirmBtn.addEventListener("click", () => { this.opts.onConfirm(); this.close(); });
  }

  onClose() { this.contentEl.empty(); }
}
