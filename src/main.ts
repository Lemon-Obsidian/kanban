import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";
import { DEFAULT_BOARD, DEFAULT_SETTINGS, KanbanBoard, KanbanSettings } from "./types";
import { FileManager } from "./FileManager";
import { KanbanView, VIEW_TYPE_KANBAN } from "./KanbanView";
import { TagGroupView, VIEW_TYPE_TAG_GROUP } from "./TagGroupView";
import { slugify } from "./utils";

export default class KanbanPlugin extends Plugin {
  settings: KanbanSettings;
  fileManager: FileManager;

  private refreshTimeout: number | null = null;

  get activeBoard() {
    return this.settings.boards.find((b) => b.id === this.settings.activeBoardId)
      ?? this.settings.boards[0];
  }

  async onload() {
    await this.loadSettings();
    this.fileManager = new FileManager(this.app, this.activeBoard);

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
    // 구버전 마이그레이션: boardFolder + columns → boards[]
    if (saved && (saved.boardFolder || saved.columns) && !saved.boards) {
      this.settings = {
        boards: [{
          ...DEFAULT_BOARD,
          folder: saved.boardFolder ?? DEFAULT_BOARD.folder,
          columns: saved.columns ?? DEFAULT_BOARD.columns,
        }],
        activeBoardId: "default",
        upcomingDays: saved.upcomingDays ?? DEFAULT_SETTINGS.upcomingDays,
      };
      return;
    }
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      boards: saved?.boards ?? DEFAULT_SETTINGS.boards,
      activeBoardId: saved?.activeBoardId ?? DEFAULT_SETTINGS.activeBoardId,
      upcomingDays: saved?.upcomingDays ?? DEFAULT_SETTINGS.upcomingDays,
      recurringTasks: saved?.recurringTasks ?? DEFAULT_SETTINGS.recurringTasks,
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
  private newDayValue = "";
  private newBoardName = "";
  private newBoardFolder = "";

  constructor(app: App, private plugin: KanbanPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Kanban 설정" });

    // ── 보드 관리 ──
    containerEl.createEl("h3", { text: "보드 관리" });

    for (const board of this.plugin.settings.boards) {
      this.renderBoardSection(containerEl, board);
    }

    // ── 새 보드 추가 ──
    containerEl.createEl("h4", { text: "새 보드 추가" });
    let folderInputEl: HTMLInputElement;

    new Setting(containerEl)
      .setName("보드 이름")
      .addText((text) => {
        text.setPlaceholder("예: 개인 프로젝트").onChange((v) => {
          this.newBoardName = v;
          if (folderInputEl && !folderInputEl.value) {
            folderInputEl.value = slugify(v) || "";
            this.newBoardFolder = folderInputEl.value;
          }
        });
      });

    new Setting(containerEl)
      .setName("폴더 경로")
      .setDesc("보드 카드가 저장될 Vault 내 폴더 경로")
      .addText((text) => {
        text.setPlaceholder("예: Projects/Personal").onChange((v) => (this.newBoardFolder = v));
        folderInputEl = text.inputEl;
      })
      .addButton((btn) =>
        btn.setButtonText("추가").setCta().onClick(() => this.addBoard())
      );

    // ── Dataview 호환 ──
    containerEl.createEl("h3", { text: "Dataview 호환" });
    new Setting(containerEl)
      .setName("status 필드 마이그레이션")
      .setDesc("기존 카드 파일에 status 필드를 추가합니다. Dataview로 카드를 조회하려면 한 번 실행하세요.")
      .addButton((btn) =>
        btn.setButtonText("마이그레이션 실행").onClick(async () => {
          btn.setDisabled(true);
          btn.setButtonText("실행 중...");
          try {
            const count = await this.plugin.fileManager.migrateStatusField();
            new Notice(`마이그레이션 완료 — ${count}개 카드에 status 필드 추가됨`);
          } catch (e) {
            new Notice("마이그레이션 중 오류가 발생했습니다.");
            console.error(e);
          } finally {
            btn.setDisabled(false);
            btn.setButtonText("마이그레이션 실행");
          }
        })
      );

    // ── 마감 임박 설정 ──
    containerEl.createEl("h3", { text: "마감 임박 설정" });
    containerEl.createEl("p", {
      text: "마감 임박 뷰에서 사용할 기간(일) 목록입니다.",
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
            this.display();
          })
        );
    }

    containerEl.createEl("h4", { text: "기간 추가" });
    new Setting(containerEl)
      .setName("일 수")
      .addText((text) => {
        text.setPlaceholder("예: 14").setValue(this.newDayValue).onChange((v) => (this.newDayValue = v));
        text.inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") this.addDay(); });
      })
      .addButton((btn) => btn.setButtonText("추가").setCta().onClick(() => this.addDay()));
  }

  private renderBoardSection(containerEl: HTMLElement, board: KanbanBoard) {
    const isActive = board.id === this.plugin.settings.activeBoardId;
    const section = containerEl.createDiv("kanban-settings-board-section");

    // 보드 헤더
    const boardHeader = section.createDiv("kanban-settings-board-header");
    boardHeader.createEl("h4", {
      text: `${board.name}${isActive ? " (현재)" : ""}`,
      cls: "kanban-settings-board-title",
    });

    if (!isActive) {
      boardHeader.createEl("button", { text: "활성화", cls: "kanban-settings-board-activate-btn" })
        .addEventListener("click", async () => {
          this.plugin.settings.activeBoardId = board.id;
          this.plugin.fileManager.setBoard(board);
          await this.plugin.saveSettings();
          this.plugin.refreshAllViews();
          this.display();
        });
    }

    // 보드 이름
    new Setting(section)
      .setName("보드 이름")
      .addText((text) => {
        text.setValue(board.name).onChange((v) => { board.name = v.trim() || board.name; });
        text.inputEl.addEventListener("blur", async () => {
          await this.plugin.saveSettings();
          this.plugin.refreshAllViews();
          this.display();
        });
      });

    // 폴더
    new Setting(section)
      .setName("폴더 경로")
      .setDesc(`현재: ${board.folder}`)
      .addText((text) => {
        text.setValue(board.folder).onChange((v) => { board.folder = v.trim() || board.folder; });
        text.inputEl.addEventListener("blur", async () => {
          this.plugin.fileManager.setBoard(board);
          await this.plugin.saveSettings();
          this.plugin.refreshAllViews();
        });
      });

    // 보드 삭제
    if (this.plugin.settings.boards.length > 1) {
      new Setting(section)
        .setName("보드 삭제")
        .setDesc("이 보드와 설정을 삭제합니다. 파일은 삭제되지 않습니다.")
        .addButton((btn) =>
          btn.setButtonText("보드 삭제").setWarning().onClick(() => {
            new SettingConfirmModal(this.app, {
              title: "보드 삭제",
              message: `"${board.name}" 보드 설정을 삭제할까요? (카드 파일은 보존됩니다)`,
              confirmText: "삭제",
              onConfirm: async () => {
                const boards = this.plugin.settings.boards;
                const idx = boards.findIndex((b) => b.id === board.id);
                boards.splice(idx, 1);
                if (this.plugin.settings.activeBoardId === board.id) {
                  this.plugin.settings.activeBoardId = boards[0].id;
                  this.plugin.fileManager.setBoard(boards[0]);
                }
                await this.plugin.saveSettings();
                this.plugin.refreshAllViews();
                this.display();
              },
            }).open();
          })
        );
    }
  }

  private async addBoard() {
    const name = this.newBoardName.trim();
    const folder = this.newBoardFolder.trim();
    if (!name) { new Notice("보드 이름을 입력하세요."); return; }
    if (!folder) { new Notice("폴더 경로를 입력하세요."); return; }

    const existingIds = this.plugin.settings.boards.map((b) => b.id);
    let id = slugify(name) || `board-${Date.now()}`;
    if (existingIds.includes(id)) {
      let n = 2;
      while (existingIds.includes(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }

    const newBoard: KanbanBoard = {
      id, name, folder,
      columns: [
        { id: "todo",  label: "TO-DO",       flushable: false },
        { id: "in-progress", label: "IN PROGRESS", flushable: false },
        { id: "done",  label: "DONE",        flushable: true  },
      ],
    };
    this.plugin.settings.boards.push(newBoard);
    await this.plugin.saveSettings();
    this.plugin.fileManager.setBoard(newBoard);
    await this.plugin.fileManager.ensureFolders();
    this.plugin.fileManager.setBoard(this.plugin.activeBoard);
    this.newBoardName = "";
    this.newBoardFolder = "";
    this.display();
    new Notice(`"${name}" 보드가 추가되었습니다.`);
  }

  private async addDay() {
    const n = parseInt(this.newDayValue.trim(), 10);
    if (!n || n <= 0) { new Notice("양의 정수를 입력하세요."); return; }
    const days = this.plugin.settings.upcomingDays;
    if (days.includes(n)) { new Notice("이미 추가된 값입니다."); return; }
    days.push(n);
    days.sort((a, b) => a - b);
    await this.plugin.saveSettings();
    this.newDayValue = "";
    this.display();
    new Notice(`${n}일이 추가되었습니다.`);
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
