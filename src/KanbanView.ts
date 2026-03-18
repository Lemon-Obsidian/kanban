import { ItemView, Menu, Modal, Notice, Setting, WorkspaceLeaf } from "obsidian";
import { ArchivedCard, KanbanBoard, KanbanCard, KanbanColumn, KanbanSettings, RecurringTask } from "./types";
import { FileManager } from "./FileManager";
import { CardModal } from "./CardModal";
import { slugify, parseChecklist, formatChecklist, priorityToNum, relativeTime } from "./utils";

export const VIEW_TYPE_KANBAN = "kanban-board-view";

// ── ConfirmModal ──────────────────────────────────────────────────────────

class ConfirmModal extends Modal {
  constructor(
    app: Parameters<typeof Modal["prototype"]["constructor"]>[0],
    private opts: {
      title: string;
      message: string;
      confirmText: string;
      danger?: boolean;
      onConfirm: () => void;
    }
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("kanban-confirm-modal");
    contentEl.createEl("h3", { text: this.opts.title, cls: "kanban-confirm-title" });
    contentEl.createEl("p", { text: this.opts.message, cls: "kanban-confirm-message" });
    const btnRow = contentEl.createDiv("kanban-modal-buttons");
    btnRow.createEl("button", { text: "취소" }).addEventListener("click", () => this.close());
    const confirmBtn = btnRow.createEl("button", {
      text: this.opts.confirmText,
      cls: this.opts.danger ? "mod-warning" : "mod-cta",
    });
    confirmBtn.addEventListener("click", () => { this.opts.onConfirm(); this.close(); });

    // Enter → 확인 / Escape → 취소 (Obsidian 기본 Esc 동작 덮어쓰기)
    this.scope.register([], "Enter", (e) => {
      e.preventDefault();
      this.opts.onConfirm();
      this.close();
      return false;
    });
  }

  onClose() { this.contentEl.empty(); }
}

// ── AddColumnModal ────────────────────────────────────────────────────────

class AddColumnModal extends Modal {
  private name = "";
  private flushable = false;

  constructor(
    app: Parameters<typeof Modal["prototype"]["constructor"]>[0],
    private existingIds: string[],
    private onAdd: (col: KanbanColumn) => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "새 컬럼 추가" });

    let nameInput: HTMLInputElement;
    new Setting(contentEl).setName("컬럼 이름").addText((text) => {
      text.setPlaceholder("예: 리뷰, Backlog...").onChange((v) => (this.name = v));
      nameInput = text.inputEl;
      nameInput.style.width = "100%";
    });

    new Setting(contentEl)
      .setName("보관 가능")
      .setDesc("이 컬럼의 카드를 일괄 아카이브로 보관할 수 있습니다")
      .addToggle((t) => t.setValue(false).onChange((v) => (this.flushable = v)));

    const btnRow = contentEl.createDiv("kanban-modal-buttons");
    btnRow.createEl("button", { text: "취소" }).addEventListener("click", () => this.close());
    btnRow.createEl("button", { text: "추가", cls: "mod-cta" })
      .addEventListener("click", () => this.submit());

    setTimeout(() => nameInput?.focus(), 50);
    contentEl.addEventListener("keydown", (e) => { if (e.key === "Enter") this.submit(); });
  }

  private submit() {
    const name = this.name.trim();
    if (!name) { new Notice("컬럼 이름을 입력하세요."); return; }

    let id = slugify(name) || `col-${Date.now()}`;
    if (this.existingIds.includes(id)) {
      let n = 2;
      while (this.existingIds.includes(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }

    this.onAdd({ id, label: name, flushable: this.flushable });
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

// ── AddBoardModal ─────────────────────────────────────────────────────────

class AddBoardModal extends Modal {
  private name = "";
  private folder = "";

  constructor(
    app: Parameters<typeof Modal["prototype"]["constructor"]>[0],
    private existingIds: string[],
    private onAdd: (board: KanbanBoard) => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "새 보드 만들기" });

    let nameInput: HTMLInputElement;
    new Setting(contentEl).setName("보드 이름").addText((text) => {
      text.setPlaceholder("예: 개인 프로젝트").onChange((v) => {
        this.name = v;
        if (!this.folder) {
          folderInput.value = slugify(v) || "";
          this.folder = folderInput.value;
        }
      });
      nameInput = text.inputEl;
    });

    let folderInput: HTMLInputElement;
    new Setting(contentEl)
      .setName("폴더 경로")
      .setDesc("보드 카드가 저장될 Vault 내 폴더 경로")
      .addText((text) => {
        text.setPlaceholder("예: Projects/Personal").onChange((v) => (this.folder = v));
        folderInput = text.inputEl;
      });

    const btnRow = contentEl.createDiv("kanban-modal-buttons");
    btnRow.createEl("button", { text: "취소" }).addEventListener("click", () => this.close());
    btnRow.createEl("button", { text: "만들기", cls: "mod-cta" })
      .addEventListener("click", () => this.submit());

    setTimeout(() => nameInput?.focus(), 50);
    contentEl.addEventListener("keydown", (e) => { if (e.key === "Enter") this.submit(); });
  }

  private submit() {
    const name = this.name.trim();
    const folder = this.folder.trim();
    if (!name) { new Notice("보드 이름을 입력하세요."); return; }
    if (!folder) { new Notice("폴더 경로를 입력하세요."); return; }

    let id = slugify(name) || `board-${Date.now()}`;
    if (this.existingIds.includes(id)) {
      let n = 2;
      while (this.existingIds.includes(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }

    this.onAdd({
      id,
      name,
      folder,
      columns: [
        { id: "todo",  label: "TO-DO",       flushable: false },
        { id: "in-progress", label: "IN PROGRESS", flushable: false },
        { id: "done",  label: "DONE",        flushable: true  },
      ],
    });
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

// ── FlushConfirmModal ─────────────────────────────────────────────────────

class FlushConfirmModal extends Modal {
  constructor(
    app: Parameters<typeof Modal["prototype"]["constructor"]>[0],
    private columnLabel: string,
    private count: number,
    private onConfirm: () => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "카드 보관" });
    contentEl.createEl("p", {
      text: `"${this.columnLabel}" 컬럼의 카드 ${this.count}개를 아카이브로 보관합니다. 계속하시겠습니까?`,
    });
    const btnRow = contentEl.createDiv("kanban-modal-buttons");
    btnRow.createEl("button", { text: "취소" }).addEventListener("click", () => this.close());
    const confirmBtn = btnRow.createEl("button", { text: "보관하기", cls: "mod-warning" });
    confirmBtn.addEventListener("click", () => { this.onConfirm(); this.close(); });
  }

  onClose() { this.contentEl.empty(); }
}

// ── RenameColumnModal ─────────────────────────────────────────────────────

class RenameColumnModal extends Modal {
  private value: string;

  constructor(
    app: Parameters<typeof Modal["prototype"]["constructor"]>[0],
    private currentLabel: string,
    private onRename: (newLabel: string) => void
  ) {
    super(app);
    this.value = currentLabel;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "컬럼명 수정" });
    let inputEl: HTMLInputElement;
    new Setting(contentEl).setName("새 이름").addText((t) => {
      t.setValue(this.currentLabel).onChange((v) => (this.value = v));
      inputEl = t.inputEl;
      inputEl.style.width = "100%";
      setTimeout(() => { inputEl.select(); }, 50);
    });
    const btnRow = contentEl.createDiv("kanban-modal-buttons");
    btnRow.createEl("button", { text: "취소" }).addEventListener("click", () => this.close());
    btnRow.createEl("button", { text: "저장", cls: "mod-cta" })
      .addEventListener("click", () => this.submit());
    contentEl.addEventListener("keydown", (e) => { if (e.key === "Enter") this.submit(); });
  }

  private submit() {
    const name = this.value.trim();
    if (!name) { new Notice("컬럼 이름을 입력하세요."); return; }
    this.onRename(name);
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

// ── KanbanView ────────────────────────────────────────────────────────────

type ViewMode = "board" | "archive" | "upcoming";
type SortBy = "created" | "due" | "priority" | "title";

export class KanbanView extends ItemView {
  private cards: KanbanCard[] = [];
  private draggedCard: KanbanCard | null = null;
  private activeTagFilter: string | null = null;
  private boardSearch = "";
  private sortBy: SortBy = "created";
  private sortDir: "asc" | "desc" = "desc";
  private boardColumnsEl: HTMLElement | null = null;
  private statsBarEl: HTMLElement | null = null;
  private detailPanelEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private selectedCard: KanbanCard | null = null;

  private draggedColumnId: string | null = null;
  private viewMode: ViewMode = "board";
  private archivedCards: ArchivedCard[] = [];
  private archiveSearch = "";
  private archiveMonthFilter: string | null = null;
  private archiveColumnFilter: string | null = null;
  private archiveTagFilter: string | null = null;
  private upcomingDayFilter: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private fileManager: FileManager,
    private settings: KanbanSettings,
    private saveSettings: () => Promise<void>
  ) {
    super(leaf);
  }

  private get activeBoard() {
    return this.settings.boards.find((b) => b.id === this.settings.activeBoardId)
      ?? this.settings.boards[0];
  }

  getViewType() { return VIEW_TYPE_KANBAN; }
  getDisplayText() { return "Kanban Board"; }
  getIcon() { return "columns"; }

  async onOpen() {
    await this.refresh();
    await this.checkRecurringTasks();
    this.registerDomEvent(document, "keydown", (e: KeyboardEvent) => {
      if (this.app.workspace.activeLeaf !== this.leaf) return;
      this.handleKeydown(e);
    });
  }

  async refresh() {
    if (this.viewMode === "board" || this.viewMode === "upcoming") {
      this.cards = await this.fileManager.loadCards();
      // 편집/이동 후 selectedCard를 최신 데이터로 갱신
      if (this.selectedCard) {
        this.selectedCard = this.cards.find((c) => c.filePath === this.selectedCard!.filePath) ?? null;
      }
    } else {
      this.archivedCards = await this.fileManager.loadArchivedCards();
    }
    this.render();
  }

  private render() {
    if (this.viewMode === "board") this.renderBoard();
    else if (this.viewMode === "archive") this.renderArchive();
    else this.renderUpcoming();
  }

  // ── 보드 뷰 ─────────────────────────────────────────────────────────────

  private renderBoard() {
    const { containerEl } = this;
    containerEl.empty();
    this.boardColumnsEl = null;
    this.statsBarEl = null;
    this.searchInputEl = null;
    this.detailPanelEl = null;
    containerEl.addClass("kanban-container");

    // 메인 영역 (헤더 + 보드 컬럼)
    const mainArea = containerEl.createDiv("kanban-main-area");
    const header = mainArea.createDiv("kanban-header");

    const titleRow = header.createDiv("kanban-header-title-row");

    // 보드 선택 드롭다운
    const boardSwitcher = titleRow.createDiv("kanban-board-switcher");
    const boardSelect = boardSwitcher.createEl("select", { cls: "kanban-board-select" });
    for (const board of this.settings.boards) {
      const opt = boardSelect.createEl("option", { text: board.name, value: board.id });
      if (board.id === this.activeBoard.id) opt.selected = true;
    }
    boardSelect.addEventListener("change", async () => {
      await this.switchBoard(boardSelect.value);
    });

    boardSwitcher.createEl("button", {
      text: "+",
      cls: "kanban-board-add-btn",
      title: "새 보드 만들기",
    }).addEventListener("click", () => {
      new AddBoardModal(
        this.app,
        this.settings.boards.map((b) => b.id),
        async (newBoard) => {
          this.settings.boards.push(newBoard);
          this.settings.activeBoardId = newBoard.id;
          this.fileManager.setBoard(newBoard);
          await this.saveSettings();
          await this.fileManager.ensureFolders();
          this.boardSearch = "";
          this.activeTagFilter = null;
          await this.refresh();
          new Notice(`"${newBoard.name}" 보드가 생성되었습니다.`);
        }
      ).open();
    });

    const headerBtns = titleRow.createDiv("kanban-header-btns");
    headerBtns.createEl("button", {
      text: "📅 마감 임박",
      cls: "kanban-header-btn",
      title: "마감일 기준으로 카드 보기",
    }).addEventListener("click", () => this.switchToUpcoming());

    headerBtns.createEl("button", {
      text: "🗃 아카이브",
      cls: "kanban-header-btn",
      title: "아카이브 히스토리 보기",
    }).addEventListener("click", () => this.switchToArchive());

    headerBtns.createEl("button", {
      text: "🔁 반복 관리",
      cls: "kanban-header-btn",
      title: "반복 작업 관리",
    }).addEventListener("click", () => this.openRecurringTasksModal());

    // 검색 + 정렬
    const controlsRow = header.createDiv("kanban-controls-row");

    const searchInput = controlsRow.createEl("input", {
      type: "text",
      cls: "kanban-search-input",
    });
    searchInput.placeholder = "🔍  카드 검색 (제목, 내용, 태그)...    [/]";
    this.searchInputEl = searchInput;
    searchInput.value = this.boardSearch;
    searchInput.addEventListener("input", (e) => {
      this.boardSearch = (e.target as HTMLInputElement).value;
      this.renderBoardColumns();
    });

    const sortGroup = controlsRow.createDiv("kanban-sort-group");
    const sortOptions: { value: SortBy; label: string }[] = [
      { value: "created",  label: "생성일" },
      { value: "due",      label: "마감일" },
      { value: "priority", label: "우선순위" },
      { value: "title",    label: "제목" },
    ];

    const updateSortButtons = () => {
      sortGroup.querySelectorAll<HTMLElement>(".kanban-sort-btn").forEach((btn, i) => {
        const opt = sortOptions[i];
        const isActive = this.sortBy === opt.value;
        btn.textContent = opt.label + (isActive ? (this.sortDir === "desc" ? " ↓" : " ↑") : "");
        btn.classList.toggle("active", isActive);
      });
    };

    for (const opt of sortOptions) {
      const isActive = this.sortBy === opt.value;
      const btn = sortGroup.createEl("button", {
        text: opt.label + (isActive ? (this.sortDir === "desc" ? " ↓" : " ↑") : ""),
        cls: `kanban-sort-btn${isActive ? " active" : ""}`,
      });
      btn.addEventListener("click", () => {
        if (this.sortBy === opt.value) {
          this.sortDir = this.sortDir === "desc" ? "asc" : "desc";
        } else {
          this.sortBy = opt.value;
          this.sortDir = opt.value === "created" ? "desc" : "asc";
        }
        updateSortButtons();
        this.renderBoardColumns();
      });
    }

    this.renderTagFilterBar(header);

    this.statsBarEl = header.createDiv("kanban-stats-bar");

    // 단축키 힌트 바
    const shortcutBar = header.createDiv("kanban-shortcut-bar");
    for (const { key, label } of [
      { key: "N", label: "새 카드" },
      { key: "/", label: "검색" },
      { key: "E", label: "편집" },
      { key: "Del", label: "삭제" },
      { key: "Esc", label: "닫기" },
    ]) {
      const item = shortcutBar.createSpan("kanban-shortcut-item");
      item.createEl("kbd", { text: key, cls: "kanban-kbd" });
      item.createSpan({ text: " " + label });
    }

    this.boardColumnsEl = mainArea.createDiv("kanban-board");
    this.renderBoardColumns();

    // 상세 패널
    this.detailPanelEl = containerEl.createDiv("kanban-detail-panel");
    if (this.selectedCard) this.renderDetailPanel(this.selectedCard);
  }

  private renderBoardColumns() {
    if (!this.boardColumnsEl) return;
    this.boardColumnsEl.empty();

    // 통계 바 업데이트
    if (this.statsBarEl) {
      this.statsBarEl.empty();
      const today = new Date().toISOString().split("T")[0];
      const doneColIds = new Set(this.activeBoard.columns.filter((c) => c.flushable).map((c) => c.id));
      const total = this.cards.length;
      const done = this.cards.filter((c) => doneColIds.has(c.status)).length;
      const overdue = this.cards.filter((c) => c.due && c.due < today && !doneColIds.has(c.status)).length;

      const stat = (label: string, value: number, cls?: string) => {
        const el = this.statsBarEl!.createSpan({ cls: `kanban-stat-item${cls ? " " + cls : ""}` });
        el.createSpan({ text: String(value), cls: "kanban-stat-value" });
        el.createSpan({ text: " " + label, cls: "kanban-stat-label" });
      };
      stat("전체", total);
      stat("완료", done);
      if (overdue > 0) stat("기한 초과", overdue, "kanban-stat-overdue");
    }

    for (const col of this.activeBoard.columns) {
      this.renderColumn(this.boardColumnsEl, col.id, col.label, col.flushable ?? false);
    }

    const addColPlaceholder = this.boardColumnsEl.createDiv("kanban-add-column-placeholder");
    addColPlaceholder.createDiv({ text: "+", cls: "kanban-add-column-plus" });
    addColPlaceholder.createDiv({ text: "컬럼 추가", cls: "kanban-add-column-label" });
    addColPlaceholder.addEventListener("click", () => {
      new AddColumnModal(
        this.app,
        this.activeBoard.columns.map((c) => c.id),
        async (newCol) => {
          this.activeBoard.columns.push(newCol);
          await this.saveSettings();
          await this.fileManager.ensureFolders();
          await this.refresh();
          new Notice(`"${newCol.label}" 컬럼이 추가되었습니다.`);
        }
      ).open();
    });
  }

  private renderTagFilterBar(parent: HTMLElement) {
    const allTags = new Set<string>();
    this.cards.forEach((c) => c.tags.forEach((t) => allTags.add(t)));
    if (allTags.size === 0) return;

    const bar = parent.createDiv("kanban-tag-filter-bar");

    // 태그별 카드 수 미리 계산
    const tagCount = new Map<string, number>();
    for (const card of this.cards) {
      for (const tag of card.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
    }

    const makeTagBtn = (label: string, count: number, active: boolean, onClick: () => void) => {
      const btn = bar.createEl("button", { cls: `kanban-tag-btn${active ? " active" : ""}` });
      btn.createSpan({ text: label });
      btn.createSpan({ text: String(count), cls: "kanban-tag-btn-count" });
      btn.addEventListener("click", onClick);
    };

    makeTagBtn("전체", this.cards.length, this.activeTagFilter === null,
      () => { this.activeTagFilter = null; this.render(); });

    for (const tag of [...allTags].sort()) {
      makeTagBtn(`#${tag}`, tagCount.get(tag) ?? 0, this.activeTagFilter === tag,
        () => { this.activeTagFilter = this.activeTagFilter === tag ? null : tag; this.render(); });
    }
  }

  private renderColumn(parent: HTMLElement, columnId: string, label: string, flushable: boolean) {
    const allCards = this.getFilteredCards(columnId);

    const col = parent.createDiv("kanban-column");
    col.dataset.status = columnId;

    // 컬럼 드래그 앤 드랍
    col.addEventListener("dragstart", (e) => {
      if (!col.draggable) return;
      this.draggedColumnId = columnId;
      e.dataTransfer?.setData("text/plain", columnId);
      setTimeout(() => col.addClass("col-dragging"), 0);
    });
    col.addEventListener("dragend", () => {
      col.draggable = false;
      col.removeClass("col-dragging");
      this.draggedColumnId = null;
      parent.querySelectorAll<HTMLElement>(".kanban-column").forEach((el) => el.removeClass("col-drag-over"));
    });
    col.addEventListener("dragover", (e) => {
      if (!this.draggedColumnId || this.draggedColumnId === columnId) return;
      e.preventDefault();
      col.addClass("col-drag-over");
    });
    col.addEventListener("dragleave", (e) => {
      if (!col.contains(e.relatedTarget as Node)) col.removeClass("col-drag-over");
    });
    col.addEventListener("drop", async (e) => {
      if (!this.draggedColumnId || this.draggedColumnId === columnId) return;
      e.preventDefault();
      col.removeClass("col-drag-over");
      const fromId = this.draggedColumnId;
      const fromIdx = this.activeBoard.columns.findIndex((c) => c.id === fromId);
      const toIdx = this.activeBoard.columns.findIndex((c) => c.id === columnId);
      if (fromIdx !== -1 && toIdx !== -1) {
        const [removed] = this.activeBoard.columns.splice(fromIdx, 1);
        this.activeBoard.columns.splice(toIdx, 0, removed);
        await this.saveSettings();
        await this.refresh();
      }
    });

    // 헤더
    const colHeader = col.createDiv("kanban-column-header");
    const colHeaderLeft = colHeader.createDiv("kanban-column-header-left");
    const dragHandle = colHeaderLeft.createSpan({ text: "⠿", cls: "kanban-col-drag-handle", title: "드래그하여 순서 변경" });
    dragHandle.addEventListener("mousedown", () => { col.draggable = true; });
    dragHandle.addEventListener("mouseup", () => { if (!this.draggedColumnId) col.draggable = false; });
    colHeaderLeft.createEl("h2", { text: label, cls: "kanban-column-title" });
    colHeaderLeft.createDiv({ text: String(allCards.length), cls: "kanban-column-count" });

    const colHeaderRight = colHeader.createDiv("kanban-column-header-right");

    if (flushable && allCards.length > 0) {
      colHeaderRight.createEl("button", {
        text: `보관 (${allCards.length})`,
        cls: "kanban-flush-btn",
        title: `${allCards.length}개 카드를 아카이브로 보관`,
      }).addEventListener("click", () => this.openFlushModal(columnId, label, allCards.length));
    }

    colHeaderRight.createEl("button", {
      text: "+",
      cls: "kanban-col-icon-btn",
      title: "새 카드 추가",
    }).addEventListener("click", () => this.openAddModal(columnId));

    colHeaderRight.createEl("button", {
      text: "···",
      cls: "kanban-col-icon-btn kanban-col-menu-btn",
      title: "컬럼 옵션",
    }).addEventListener("click", (e) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle("컬럼명 수정").setIcon("pencil").onClick(() => {
          new RenameColumnModal(this.app, label, async (newLabel) => {
            const col = this.activeBoard.columns.find((c) => c.id === columnId);
            if (!col) return;
            const newId = slugify(newLabel) || columnId;
            const idConflict = newId !== columnId && this.activeBoard.columns.some((c) => c.id === newId);
            if (idConflict) {
              new Notice(`"${newId}" 폴더가 이미 존재합니다. 다른 이름을 사용하세요.`);
              return;
            }
            await this.fileManager.renameColumn(columnId, newId);
            col.id = newId;
            col.label = newLabel;
            await this.saveSettings();
            await this.refresh();
            new Notice(`컬럼명이 "${newLabel}"으로 수정되었습니다.`);
          }).open();
        })
      );
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle("컬럼 삭제").setIcon("trash").onClick(async () => {
          if (this.activeBoard.columns.length <= 1) {
            new Notice("최소 1개의 컬럼이 필요합니다.");
            return;
          }
          const cardCount = allCards.length;
          const message = cardCount > 0
            ? `"${label}" 컬럼과 카드 ${cardCount}개가 모두 삭제됩니다. 계속하시겠습니까?`
            : `"${label}" 컬럼을 삭제할까요?`;
          new ConfirmModal(this.app, {
            title: "컬럼 삭제",
            message,
            confirmText: "삭제",
            danger: true,
            onConfirm: async () => {
              await this.fileManager.deleteColumn(columnId);
              this.activeBoard.columns = this.activeBoard.columns.filter((c) => c.id !== columnId);
              await this.saveSettings();
              await this.refresh();
              new Notice(`"${label}" 컬럼이 삭제되었습니다.`);
            },
          }).open();
        })
      );
      menu.showAtMouseEvent(e);
    });

    // 카드 목록
    const cardsEl = col.createDiv("kanban-cards");

    cardsEl.addEventListener("dragover", (e) => {
      if (this.draggedColumnId) return;
      e.preventDefault();
      col.addClass("drag-over");
    });
    cardsEl.addEventListener("dragleave", (e) => {
      if (!col.contains(e.relatedTarget as Node)) col.removeClass("drag-over");
    });
    cardsEl.addEventListener("drop", async (e) => {
      if (this.draggedColumnId) return;
      e.preventDefault();
      col.removeClass("drag-over");
      if (this.draggedCard && this.draggedCard.status !== columnId) {
        const moved = this.draggedCard;
        this.draggedCard = null;
        await this.moveCard(moved, columnId);
      }
    });

    if (allCards.length === 0) {
      cardsEl.createDiv({ text: "카드 없음", cls: "kanban-empty-col" });
    } else {
      for (const card of allCards) this.renderCard(cardsEl, card);
    }

    // 퀵 추가
    const quickAddEl = col.createDiv("kanban-quick-add");
    const quickInputWrap = quickAddEl.createDiv("kanban-quick-add-wrap");
    const quickInput = quickInputWrap.createEl("input", {
      type: "text",
      cls: "kanban-quick-add-input",
    });
    quickInput.placeholder = "+ 카드 추가...";
    this.attachQuickAddSuggest(quickInput, quickInputWrap);

    const hint = quickAddEl.createDiv("kanban-quick-add-hint");
    hint.innerHTML =
      `<span>#태그</span> 태그 &nbsp;·&nbsp; ` +
      `<span>!낮음 !중간 !높음 !ASAP</span> 우선순위<br>` +
      `<span>^오늘</span> · <span>^내일</span> · <span>^N일후</span> · <span>^월~일</span> &nbsp;마감일<br>` +
      `<span>https://...</span> 링크 &nbsp;·&nbsp; <span>[이름]https://...</span> 이름 있는 링크`;
    quickInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        const raw = quickInput.value.trim();
        if (!raw) return;
        const parsed = this.parseQuickInput(raw);
        if (!parsed.title) return;
        await this.fileManager.createCard({
          ...parsed,
          created: new Date().toISOString(),
          content: "",
          status: columnId,
        });
        quickInput.value = "";
        await this.refresh();
      }
      if (e.key === "Escape") quickInput.blur();
    });
  }

  private getFilteredCards(columnId: string): KanbanCard[] {
    let cards = this.cards.filter((c) => c.status === columnId);
    if (this.activeTagFilter) {
      cards = cards.filter((c) => c.tags.includes(this.activeTagFilter!));
    }
    if (this.boardSearch) {
      const q = this.boardSearch.toLowerCase();
      const tagQ = q.startsWith("#") ? q.slice(1) : q;
      cards = cards.filter((c) =>
        c.title.toLowerCase().includes(q) ||
        c.content.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(tagQ))
      );
    }
    return this.sortCards(cards);
  }

  private sortCards(cards: KanbanCard[]): KanbanCard[] {
    return [...cards].sort((a, b) => {
      let cmp = 0;
      switch (this.sortBy) {
        case "created":
          cmp = a.created > b.created ? 1 : a.created < b.created ? -1 : 0;
          break;
        case "due": {
          const aDue = a.due ?? "9999-99-99";
          const bDue = b.due ?? "9999-99-99";
          cmp = aDue > bDue ? 1 : aDue < bDue ? -1 : 0;
          break;
        }
        case "priority":
          cmp = priorityToNum(a.priority) - priorityToNum(b.priority);
          break;
        case "title":
          cmp = a.title.localeCompare(b.title, "ko");
          break;
      }
      return this.sortDir === "asc" ? cmp : -cmp;
    });
  }

  private renderCard(parent: HTMLElement, card: KanbanCard) {
    const cardEl = parent.createDiv("kanban-card");
    if (card.priority) cardEl.dataset.priority = card.priority;
    cardEl.draggable = true;

    cardEl.addEventListener("dragstart", () => {
      this.draggedCard = card;
      setTimeout(() => cardEl.addClass("dragging"), 0);
    });
    cardEl.addEventListener("dragend", () => cardEl.removeClass("dragging"));

    // hover 액션 버튼
    const actionsEl = cardEl.createDiv("kanban-card-actions");
    actionsEl.createEl("button", { text: "✎", cls: "kanban-card-action-btn", title: "편집" })
      .addEventListener("click", (e) => { e.stopPropagation(); this.openEditModal(card); });
    actionsEl.createEl("button", { text: "✕", cls: "kanban-card-action-btn kanban-card-action-delete", title: "삭제" })
      .addEventListener("click", (e) => {
        e.stopPropagation();
        new ConfirmModal(this.app, {
          title: "카드 삭제",
          message: `"${card.title}" 카드를 삭제할까요?`,
          confirmText: "삭제",
          danger: true,
          onConfirm: async () => { await this.fileManager.deleteCard(card); await this.refresh(); },
        }).open();
      });

    // 제목 + 우선순위 chip (chip은 제목 텍스트 바로 오른쪽 인라인)
    const titleEl = cardEl.createDiv("kanban-card-title");
    this.highlightText(titleEl, card.title, this.boardSearch);
    if (card.priority && card.priority !== "medium") {
      const priorityLabel: Record<string, string> = { low: "우선순위 낮음", high: "우선순위 높음", asap: "우선순위 ASAP" };
      titleEl.createSpan({
        text: priorityLabel[card.priority],
        cls: `kanban-card-priority-chip priority-chip-${card.priority}`,
      });
    }

    // 반복 배지
    if (card.recur) {
      const recurLabel: Record<string, string> = { daily: "매일", weekly: "매주", monthly: "매월" };
      cardEl.createDiv({ text: `🔁 ${recurLabel[card.recur]}`, cls: "kanban-card-recur" });
    }

    // 마감일
    if (card.due) {
      const today = new Date().toISOString().split("T")[0];
      const overdue = card.due < today;
      cardEl.createDiv({
        text: `${overdue ? "⚠ 기한 초과 · " : "📅 "}${card.due}까지`,
        cls: `kanban-card-due${overdue ? " overdue" : ""}`,
      });
    }

    // 텍스트 미리보기 + 체크리스트
    const { text: textContent, items: checklistItems } = parseChecklist(card.content);
    if (textContent) {
      const preview = textContent.length > 100 ? textContent.slice(0, 100) + "..." : textContent;
      const contentEl = cardEl.createDiv("kanban-card-content");
      this.renderContentWithLinks(contentEl, preview, this.boardSearch);
    }

    // 체크리스트 인터랙티브 렌더링
    if (checklistItems.length > 0) {
      const checklistEl = cardEl.createDiv("kanban-card-checklist");
      for (let i = 0; i < checklistItems.length; i++) {
        const item = checklistItems[i];
        const itemEl = checklistEl.createDiv("kanban-card-checklist-item");

        const checkbox = itemEl.createEl("input");
        checkbox.type = "checkbox";
        checkbox.checked = item.checked;
        checkbox.className = "kanban-card-checklist-check";
        checkbox.addEventListener("click", async (e) => {
          e.stopPropagation();
          checklistItems[i].checked = checkbox.checked;
          const newContent = [textContent, formatChecklist(checklistItems)].filter(Boolean).join("\n\n");
          await this.fileManager.updateCard({ ...card, content: newContent });
          await this.refresh();
        });

        const textSpan = itemEl.createSpan({ cls: `kanban-card-checklist-text${item.checked ? " checked" : ""}` });
        this.renderContentWithLinks(textSpan, item.text, this.boardSearch);
      }
    }

    // 태그
    if (card.tags.length > 0) {
      const tagsEl = cardEl.createDiv("kanban-card-tags");
      const tagQ = this.boardSearch.startsWith("#") ? this.boardSearch.slice(1).toLowerCase() : "";
      for (const tag of card.tags) {
        const tagEl = tagsEl.createEl("span", {
          cls: `kanban-tag${this.activeTagFilter === tag ? " active" : ""}`,
        });
        if (tagQ) {
          tagEl.appendText("#");
          this.highlightText(tagEl, tag, tagQ);
        } else {
          tagEl.textContent = `#${tag}`;
        }
        tagEl.addEventListener("click", (e) => {
          e.stopPropagation();
          this.activeTagFilter = this.activeTagFilter === tag ? null : tag;
          this.render();
        });
      }
    }

    // 링크
    if (card.links && card.links.length > 0) {
      const linksEl = cardEl.createDiv("kanban-card-links");
      const openLink = (url: string) => window.open(url, "_blank", "noopener");

      if (card.links.length <= 3) {
        for (const link of card.links) {
          const badge = linksEl.createEl("a", {
            cls: "kanban-link-badge",
            title: link.url,
          });
          badge.appendChild(this.createFaviconImg(link.url));
          badge.createSpan({ text: link.name ?? this.shortenUrl(link.url) });
          badge.addEventListener("click", (e) => { e.stopPropagation(); openLink(link.url); });
        }
      } else {
        const btn = linksEl.createEl("button", {
          cls: "kanban-link-badge kanban-link-more-btn",
          text: `🔗 링크 ${card.links.length}개`,
        });
        const dropdown = linksEl.createDiv("kanban-link-dropdown");
        dropdown.style.display = "none";
        for (const link of card.links) {
          const item = dropdown.createDiv({ cls: "kanban-link-dropdown-item" });
          item.appendChild(this.createFaviconImg(link.url));
          item.createSpan({ text: link.name ?? this.shortenUrl(link.url), title: link.url, cls: "kanban-link-dropdown-label" });
          item.addEventListener("click", (e) => { e.stopPropagation(); openLink(link.url); });
        }
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const isOpen = dropdown.style.display !== "none";
          dropdown.style.display = isOpen ? "none" : "block";
        });
        document.addEventListener("click", () => { dropdown.style.display = "none"; }, { once: false });
      }
    }

    // 날짜 footer (생성일 · 수정일)
    const footerEl = cardEl.createDiv("kanban-card-footer");
    const createdMs = new Date(card.created).getTime();
    footerEl.createSpan({ text: `생성 ${relativeTime(createdMs)}`, cls: "kanban-card-date" });
    if (card.mtime && Math.abs(card.mtime - createdMs) > 60_000) {
      footerEl.createSpan({ text: "·", cls: "kanban-card-date-sep" });
      footerEl.createSpan({ text: `수정 ${relativeTime(card.mtime)}`, cls: "kanban-card-date" });
    }

    // 우클릭 컨텍스트 메뉴
    cardEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle("편집").setIcon("pencil").onClick(() => this.openEditModal(card))
      );
      menu.addSeparator();
      for (const col of this.activeBoard.columns) {
        if (col.id === card.status) continue;
        menu.addItem((item) =>
          item.setTitle(`${col.label}(으)로 이동`).setIcon("arrow-right")
            .onClick(() => this.moveCard(card, col.id))
        );
      }
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle("삭제").setIcon("trash").onClick(() => {
          new ConfirmModal(this.app, {
            title: "카드 삭제",
            message: `"${card.title}" 카드를 삭제할까요?`,
            confirmText: "삭제",
            danger: true,
            onConfirm: async () => { await this.fileManager.deleteCard(card); await this.refresh(); },
          }).open();
        })
      );
      menu.showAtMouseEvent(e);
    });

    cardEl.addEventListener("click", () => this.openDetailPanel(card));
  }

  private shortenUrl(url: string): string {
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, "");
    } catch {
      return url.slice(0, 20) + (url.length > 20 ? "…" : "");
    }
  }

  private createFaviconImg(url: string): HTMLImageElement {
    const img = document.createElement("img");
    img.className = "kanban-link-favicon";
    try {
      const parts = new URL(url).hostname.split(".");
      const rootDomain = parts.slice(-2).join(".");
      img.src = `https://www.google.com/s2/favicons?domain=${rootDomain}&sz=16`;
    } catch {
      img.style.display = "none";
    }
    img.addEventListener("error", () => { img.style.display = "none"; });
    return img;
  }

  private get allExistingTags(): string[] {
    return [...new Set(this.cards.flatMap((c) => c.tags))].sort();
  }

  private openAddModal(columnId: string) {
    new CardModal(this.app, {
      existingTags: this.allExistingTags,
      onSubmit: async (data) => {
        await this.fileManager.createCard({ ...data, status: columnId });
        await this.refresh();
        new Notice("카드가 추가되었습니다!");
      },
    }).open();
  }

  private openEditModal(card: KanbanCard) {
    new CardModal(this.app, {
      card,
      existingTags: this.allExistingTags,
      onSubmit: async (data) => {
        await this.fileManager.updateCard({ ...card, ...data });
        await this.refresh();
        new Notice("카드가 수정되었습니다!");
      },
    }).open();
  }

  private async moveCard(card: KanbanCard, newColumnId: string) {
    await this.fileManager.moveCard(card, newColumnId);
    await this.refresh();
  }

  private openFlushModal(columnId: string, label: string, count: number) {
    new FlushConfirmModal(this.app, label, count, async () => {
      const flushed = await this.fileManager.flushColumn(columnId);
      new Notice(`${flushed}개의 카드가 아카이브에 보관되었습니다.`);
      await this.refresh();
    }).open();
  }

  // ── 마감 임박 뷰 ──────────────────────────────────────────────────────────

  private async switchToUpcoming() {
    this.viewMode = "upcoming";
    this.upcomingDayFilter = null;
    this.cards = await this.fileManager.loadCards();
    this.render();
  }

  private renderUpcoming() {
    const { containerEl } = this;
    containerEl.empty();
    this.boardColumnsEl = null;
    containerEl.addClass("kanban-container");

    const mainArea = containerEl.createDiv("kanban-main-area");
    const header = mainArea.createDiv("kanban-header");
    const titleRow = header.createDiv("kanban-header-title-row");
    titleRow.createEl("button", { text: "← 보드로 돌아가기", cls: "kanban-back-btn" })
      .addEventListener("click", () => this.switchToBoard());
    titleRow.createEl("h2", { text: "📅 마감 임박", cls: "kanban-view-title" });

    // 기간 필터 버튼
    const configuredDays = this.settings.upcomingDays ?? [1, 7, 30];
    const filterBar = header.createDiv("kanban-tag-filter-bar");
    filterBar.createEl("button", {
      text: "전체",
      cls: `kanban-tag-btn${this.upcomingDayFilter === null ? " active" : ""}`,
    }).addEventListener("click", () => { this.upcomingDayFilter = null; this.renderUpcoming(); });
    for (const d of configuredDays) {
      filterBar.createEl("button", {
        text: `${d}일`,
        cls: `kanban-tag-btn${this.upcomingDayFilter === d ? " active" : ""}`,
      }).addEventListener("click", () => { this.upcomingDayFilter = d; this.renderUpcoming(); });
    }

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const todayStr = todayDate.toISOString().split("T")[0];

    // 필터 기준 상한일
    let limitStr: string | null = null;
    if (this.upcomingDayFilter !== null) {
      const limitDate = new Date(todayDate);
      limitDate.setDate(limitDate.getDate() + this.upcomingDayFilter);
      limitStr = limitDate.toISOString().split("T")[0];
    }

    const activeColumnIds = new Set(this.activeBoard.columns.map((c) => c.id));
    let cardsWithDue = this.cards.filter((c) => c.due && activeColumnIds.has(c.status));

    // 기간 필터 적용: 기한 초과는 항상 포함, 미래 카드는 limitStr 이내만
    if (limitStr !== null) {
      cardsWithDue = cardsWithDue.filter((c) => c.due! < todayStr || c.due! <= limitStr!);
    }

    // 그룹 분기: 선택된 필터에 맞춰 동적으로 구성
    type Group = { key: string; label: string; cards: typeof cardsWithDue };
    const groups: Group[] = [];
    groups.push({ key: "overdue", label: "기한 초과", cards: cardsWithDue.filter((c) => c.due! < todayStr) });
    groups.push({ key: "today",   label: "오늘",      cards: cardsWithDue.filter((c) => c.due === todayStr) });

    if (limitStr === null) {
      // 전체 모드: 7일/30일/이후 고정 구간
      const weekDate = new Date(todayDate); weekDate.setDate(weekDate.getDate() + 7);
      const weekStr = weekDate.toISOString().split("T")[0];
      const monthDate = new Date(todayDate); monthDate.setDate(monthDate.getDate() + 30);
      const monthStr = monthDate.toISOString().split("T")[0];
      groups.push({ key: "week",  label: "7일 이내",  cards: cardsWithDue.filter((c) => c.due! > todayStr && c.due! <= weekStr) });
      groups.push({ key: "month", label: "30일 이내", cards: cardsWithDue.filter((c) => c.due! > weekStr && c.due! <= monthStr) });
      groups.push({ key: "later", label: "이후",      cards: cardsWithDue.filter((c) => c.due! > monthStr) });
    } else {
      // 필터 모드: 오늘 이후 ~ limitStr 단일 구간
      groups.push({
        key: "upcoming",
        label: `${this.upcomingDayFilter}일 이내`,
        cards: cardsWithDue.filter((c) => c.due! > todayStr && c.due! <= limitStr!),
      });
    }

    const content = mainArea.createDiv("kanban-list-content");
    let hasAny = false;

    for (const group of groups) {
      if (group.cards.length === 0) continue;
      hasAny = true;
      const section = content.createDiv("kanban-list-section");
      const sh = section.createDiv("kanban-list-section-header");
      sh.createSpan({ text: group.label, cls: `kanban-list-section-label${group.key === "overdue" ? " overdue" : ""}` });
      sh.createSpan({ text: String(group.cards.length), cls: "kanban-list-section-count" });
      const sorted = [...group.cards].sort((a, b) => a.due! > b.due! ? 1 : a.due! < b.due! ? -1 : 0);
      for (const card of sorted) this.renderListCard(section, card);
    }

    if (!hasAny) {
      content.createDiv({ text: "마감일이 설정된 카드가 없습니다.", cls: "kanban-empty-state-text" });
    }
  }

  // ── 아카이브 뷰 ──────────────────────────────────────────────────────────

  private async switchToArchive() {
    this.viewMode = "archive";
    this.archivedCards = await this.fileManager.loadArchivedCards();
    this.archiveSearch = "";
    this.archiveMonthFilter = null;
    this.archiveColumnFilter = null;
    this.archiveTagFilter = null;
    this.render();
  }

  private switchToBoard() {
    this.viewMode = "board";
    this.boardColumnsEl = null;
    this.render();
  }

  private async switchBoard(boardId: string) {
    const board = this.settings.boards.find((b) => b.id === boardId);
    if (!board) return;
    this.settings.activeBoardId = boardId;
    this.fileManager.setBoard(board);
    this.boardSearch = "";
    this.activeTagFilter = null;
    this.viewMode = "board";
    await this.saveSettings();
    await this.refresh();
  }

  private renderArchive() {
    const { containerEl } = this;
    containerEl.empty();
    this.boardColumnsEl = null;
    containerEl.addClass("kanban-container");

    const mainArea = containerEl.createDiv("kanban-main-area");
    const header = mainArea.createDiv("kanban-header");
    const titleRow = header.createDiv("kanban-header-title-row");
    titleRow.createEl("button", { text: "← 보드로 돌아가기", cls: "kanban-back-btn" })
      .addEventListener("click", () => this.switchToBoard());
    titleRow.createEl("h2", { text: "🗃 아카이브 히스토리", cls: "kanban-view-title" });

    const searchInput = header.createEl("input", {
      type: "text",
      placeholder: "🔍  제목, 내용, 태그 검색...",
      cls: "kanban-search-input",
    });
    searchInput.style.width = "100%";
    searchInput.style.marginBottom = "10px";
    searchInput.value = this.archiveSearch;
    searchInput.addEventListener("input", (e) => {
      this.archiveSearch = (e.target as HTMLInputElement).value;
      this.renderArchiveContent(content);
    });

    const filterBar = header.createDiv("kanban-archive-filters");
    this.renderArchiveFilterRow(filterBar, "월", this.getArchiveMonths(), this.archiveMonthFilter,
      (v) => { this.archiveMonthFilter = v; this.renderArchiveContent(content); },
      (m) => this.formatMonth(m));
    this.renderArchiveFilterRow(filterBar, "컬럼", this.getArchiveColumns(), this.archiveColumnFilter,
      (v) => { this.archiveColumnFilter = v; this.renderArchiveContent(content); },
      (id) => this.activeBoard.columns.find((c) => c.id === id)?.label ?? id);
    this.renderArchiveFilterRow(filterBar, "태그", this.getArchiveTags(), this.archiveTagFilter,
      (v) => { this.archiveTagFilter = v; this.renderArchiveContent(content); },
      (t) => `#${t}`);

    const content = mainArea.createDiv("kanban-list-content");
    this.renderArchiveContent(content);
  }

  private renderArchiveFilterRow(
    parent: HTMLElement, label: string, values: string[],
    active: string | null, onChange: (v: string | null) => void, format: (v: string) => string
  ) {
    if (values.length === 0) return;
    const row = parent.createDiv("kanban-archive-filter-row");
    row.createSpan({ text: `${label}: `, cls: "kanban-filter-label" });
    row.createEl("button", { text: "전체", cls: `kanban-tag-btn${active === null ? " active" : ""}` })
      .addEventListener("click", () => { onChange(null); this.renderArchive(); });
    for (const v of values) {
      row.createEl("button", { text: format(v), cls: `kanban-tag-btn${active === v ? " active" : ""}` })
        .addEventListener("click", () => { onChange(v); this.renderArchive(); });
    }
  }

  private renderArchiveContent(container: HTMLElement) {
    container.empty();
    const filtered = this.getFilteredArchived();

    if (filtered.length === 0) {
      container.createDiv({ text: "아카이브된 카드가 없습니다.", cls: "kanban-empty-state-text" });
      return;
    }

    const groups = new Map<string, ArchivedCard[]>();
    for (const card of filtered) {
      const month = card.flushedAt.slice(0, 7);
      if (!groups.has(month)) groups.set(month, []);
      groups.get(month)!.push(card);
    }

    for (const [month, cards] of [...groups.entries()].sort().reverse()) {
      const section = container.createDiv("kanban-list-section");
      const sh = section.createDiv("kanban-list-section-header");
      sh.createSpan({ text: this.formatMonth(month), cls: "kanban-list-section-label" });
      sh.createSpan({ text: String(cards.length), cls: "kanban-list-section-count" });
      for (const card of cards) this.renderListCard(section, card, card.flushedAt);
    }
  }

  private renderListCard(parent: HTMLElement, card: KanbanCard, flushedAt?: string) {
    const flushedFrom = (card as ArchivedCard).flushedFrom;
    const colId = flushedFrom ?? card.status;
    const colLabel = this.activeBoard.columns.find((c) => c.id === colId)?.label ?? colId;
    const priorityColor: Record<string, string> = { low: "#3498db", high: "#f39c12", asap: "#e74c3c" };

    const cardEl = parent.createDiv("kanban-list-card");

    const topRow = cardEl.createDiv("kanban-list-card-top");
    topRow.createSpan({ text: colLabel, cls: `kanban-status-badge status-${colId}` });
    topRow.createSpan({ text: card.title, cls: "kanban-list-card-title" });
    if (card.priority && card.priority !== "medium") {
      const dot = topRow.createSpan({ cls: "kanban-priority-dot" });
      dot.style.background = priorityColor[card.priority] ?? "";
    }

    const metaRow = cardEl.createDiv("kanban-list-card-meta");
    if (card.due) {
      const today = new Date().toISOString().split("T")[0];
      metaRow.createSpan({
        text: `📅 ${card.due}`,
        cls: `kanban-tag${card.due < today && !flushedAt ? " overdue-tag" : ""}`,
      });
    }
    if (flushedAt) {
      metaRow.createSpan({
        text: `🗃 ${new Date(flushedAt).toLocaleDateString("ko-KR")} 보관`,
        cls: "kanban-archive-flush-date",
      });
    }
    for (const tag of card.tags) {
      metaRow.createSpan({ text: `#${tag}`, cls: "kanban-tag" });
    }

    const { items: checklistItems } = parseChecklist(card.content);
    if (checklistItems.length > 0) {
      const checked = checklistItems.filter((i) => i.checked).length;
      const total = checklistItems.length;
      const isComplete = checked === total;
      const clWrap = metaRow.createDiv("kanban-checklist-wrap");
      clWrap.createSpan({
        text: `☑ ${checked}/${total}`,
        cls: `kanban-checklist-progress${isComplete ? " complete" : ""}`,
      });
      const bar = clWrap.createDiv("kanban-checklist-bar");
      const fill = bar.createDiv("kanban-checklist-bar-fill");
      fill.style.width = `${Math.round((checked / total) * 100)}%`;
      if (isComplete) fill.addClass("complete");
    }

    cardEl.addEventListener("click", () => {
      if (flushedAt) {
        new CardModal(this.app, {
          card,
          existingTags: this.allExistingTags,
          onSubmit: async (data) => {
            await this.fileManager.updateArchivedCard({ ...(card as ArchivedCard), ...data });
            this.archivedCards = await this.fileManager.loadArchivedCards();
            this.renderArchive();
            new Notice("카드가 수정되었습니다!");
          },
        }).open();
      } else {
        this.openEditModal(card);
      }
    });
  }

  // ── 반복 작업 스케줄러 ────────────────────────────────────────────────────
  //
  // 동작 방식:
  //   - Kanban 뷰가 열릴 때 실행
  //   - 현재 보드의 반복 작업 정의(settings.recurringTasks)를 순회
  //   - 각 작업의 lastCreated와 현재 시각을 비교해 interval이 지났으면 카드 생성
  //   - 이전 카드 완료 여부, DONE 컬럼 상태 등과 무관하게 시간 기반으로만 판단
  //   - 몇 주를 안 열어도 1개만 생성 (누락 인스턴스 누적 없음)

  private async checkRecurringTasks() {
    const tasks = this.settings.recurringTasks.filter(
      (t) => t.boardId === this.activeBoard.id
    );
    if (tasks.length === 0) return;

    const now = new Date();
    let created = 0;

    for (const task of tasks) {
      if (!this.isRecurTaskDue(task, now)) continue;

      const targetCol =
        this.activeBoard.columns.find((c) => c.id === task.targetColumnId) ??
        this.activeBoard.columns.find((c) => !c.flushable);
      if (!targetCol) continue;

      // 마감일: dueDaysOffset 기준 계산
      let due: string | undefined;
      if (task.dueDaysOffset && task.dueDaysOffset > 0) {
        const d = new Date(now);
        d.setDate(d.getDate() + task.dueDaysOffset);
        due = d.toISOString().slice(0, 10);
      }

      // 내용: 텍스트 + 체크리스트 조합
      const checklistStr = task.checklist?.length
        ? formatChecklist(task.checklist.map((t) => ({ text: t, checked: false })))
        : "";
      const fullContent = [task.content?.trim() ?? "", checklistStr].filter(Boolean).join("\n\n");

      await this.fileManager.createCard({
        title: task.title,
        tags: task.tags,
        priority: task.priority,
        due,
        recur: task.recur,
        created: now.toISOString(),
        content: fullContent,
        status: targetCol.id,
      });

      task.lastCreated = now.toISOString();
      created++;
    }

    if (created > 0) {
      await this.saveSettings();
      new Notice(`🔁 반복 작업 ${created}개가 자동 생성되었습니다.`);
      await this.refresh();
    }
  }

  private isRecurTaskDue(task: RecurringTask, now: Date): boolean {
    if (!task.lastCreated) return true; // 한 번도 생성된 적 없으면 즉시 생성
    const last = new Date(task.lastCreated);
    const diffDays = (now.getTime() - last.getTime()) / 86_400_000;
    if (task.recur === "daily") return diffDays >= 1;
    if (task.recur === "weekly") {
      if (task.dayOfWeek !== undefined) {
        // 오늘이 지정 요일이고 마지막 생성이 6일 이상 전이어야 함 (같은 주 중복 방지)
        return now.getDay() === task.dayOfWeek && diffDays >= 6;
      }
      return diffDays >= 7;
    }
    if (task.recur === "monthly") {
      if (task.dayOfMonth !== undefined) {
        // 오늘이 지정 날짜이고 마지막 생성이 25일 이상 전이어야 함 (같은 달 중복 방지)
        return now.getDate() === task.dayOfMonth && diffDays >= 25;
      }
      return diffDays >= 30;
    }
    return false;
  }

  // ── 빠른 입력 파서 ────────────────────────────────────────────────────────

  private attachQuickAddSuggest(input: HTMLInputElement, wrapper: HTMLElement) {
    const PRIORITY_OPTIONS = ["!낮음", "!중간", "!높음", "!ASAP"];
    const DUE_OPTIONS = [
      "^오늘", "^내일", "^모레",
      "^월", "^화", "^수", "^목", "^금", "^토", "^일",
      "^3일후", "^7일후", "^14일후", "^30일후",
    ];

    const dropdown = wrapper.createDiv("kanban-tag-dropdown");
    dropdown.style.display = "none";
    let activeIndex = -1;

    const getActiveToken = (): { token: string; start: number; end: number } => {
      const val = input.value;
      const pos = input.selectionStart ?? val.length;
      let start = pos;
      while (start > 0 && val[start - 1] !== " ") start--;
      return { token: val.slice(start, pos), start, end: pos };
    };

    const getAllTags = (): string[] => {
      const tagSet = new Set<string>();
      for (const card of this.cards) {
        for (const tag of card.tags) tagSet.add(tag);
      }
      return [...tagSet].sort();
    };

    const hide = () => {
      dropdown.style.display = "none";
      dropdown.empty();
      activeIndex = -1;
    };

    const selectItem = (value: string) => {
      const { start, end } = getActiveToken();
      const before = input.value.slice(0, start);
      const after = input.value.slice(end);
      input.value = `${before}${value} ${after.trimStart()}`;
      const newPos = start + value.length + 1;
      input.setSelectionRange(newPos, newPos);
      hide();
      input.focus();
    };

    const updateDropdown = () => {
      const { token } = getActiveToken();
      let candidates: string[] = [];

      if (token.startsWith("#")) {
        const query = token.slice(1).toLowerCase();
        const usedTags = new Set(
          input.value.split(/\s+/)
            .filter(t => t.startsWith("#") && t !== token)
            .map(t => t.slice(1))
        );
        const allTags = getAllTags().filter(t => !usedTags.has(t));
        candidates = query
          ? allTags.filter(t => t.toLowerCase().includes(query)).map(t => `#${t}`)
          : allTags.map(t => `#${t}`);
      } else if (token.startsWith("!")) {
        const query = token.toLowerCase();
        candidates = query === "!"
          ? PRIORITY_OPTIONS
          : PRIORITY_OPTIONS.filter(p => p.toLowerCase().startsWith(query));
      } else if (token.startsWith("^")) {
        const query = token.toLowerCase();
        candidates = query === "^"
          ? DUE_OPTIONS
          : DUE_OPTIONS.filter(d => d.toLowerCase().startsWith(query));
      }

      if (candidates.length === 0) { hide(); return; }

      dropdown.empty();
      activeIndex = -1;
      for (const cand of candidates.slice(0, 8)) {
        const item = dropdown.createDiv({ text: cand, cls: "kanban-tag-dropdown-item" });
        item.addEventListener("mousedown", (e) => { e.preventDefault(); selectItem(cand); });
      }
      dropdown.style.display = "block";
    };

    input.addEventListener("input", updateDropdown);
    input.addEventListener("keydown", (e) => {
      if (dropdown.style.display === "none") return;
      const items = dropdown.querySelectorAll<HTMLElement>(".kanban-tag-dropdown-item");
      if (items.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % items.length;
        items.forEach((el, i) => el.classList.toggle("active", i === activeIndex));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = (activeIndex - 1 + items.length) % items.length;
        items.forEach((el, i) => el.classList.toggle("active", i === activeIndex));
      } else if ((e.key === "Enter" || e.key === "Tab") && activeIndex >= 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        selectItem(items[activeIndex].textContent!);
      } else if (e.key === "Escape") {
        e.stopImmediatePropagation();
        hide();
      }
    });

    input.addEventListener("blur", () => setTimeout(hide, 150));
  }

  private parseQuickInput(raw: string): {
    title: string;
    tags: string[];
    priority?: KanbanCard["priority"];
    due?: string;
    links?: { url: string; name?: string }[];
  } {
    const PRIORITY_MAP: Record<string, KanbanCard["priority"]> = {
      "!낮음": "low", "!중간": "medium", "!높음": "high", "!ASAP": "asap", "!asap": "asap",
    };

    const tags: string[] = [];
    let priority: KanbanCard["priority"] | undefined;
    let due: string | undefined;
    const links: { url: string; name?: string }[] = [];
    const titleTokens: string[] = [];

    for (const token of raw.trim().split(/\s+/)) {
      if (token.startsWith("#") && token.length > 1) {
        tags.push(token.slice(1));
      } else if (PRIORITY_MAP[token] !== undefined) {
        priority = PRIORITY_MAP[token];
      } else if (token.startsWith("^") && token.length > 1) {
        due = this.parseQuickDue(token.slice(1));
      } else if (/^https?:\/\/\S+/.test(token)) {
        links.push({ url: token });
      } else if (/^\[.+\]https?:\/\/\S+/.test(token)) {
        const m = token.match(/^\[(.+)\](https?:\/\/\S+)/);
        if (m) links.push({ name: m[1], url: m[2] });
      } else {
        titleTokens.push(token);
      }
    }

    return { title: titleTokens.join(" "), tags, priority, due, links: links.length > 0 ? links : undefined };
  }

  private parseQuickDue(raw: string): string {
    const today = new Date();
    const addDays = (n: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + n);
      return d.toISOString().slice(0, 10);
    };

    if (raw === "오늘") return addDays(0);
    if (raw === "내일") return addDays(1);
    if (raw === "모레") return addDays(2);

    // 요일 → 가장 가까운 미래 해당 요일 (오늘 제외)
    const DAY_MAP: Record<string, number> = {
      "일": 0, "월": 1, "화": 2, "수": 3, "목": 4, "금": 5, "토": 6,
    };
    if (DAY_MAP[raw] !== undefined) {
      const target = DAY_MAP[raw];
      const diff = ((target - today.getDay() + 7) % 7) || 7;
      return addDays(diff);
    }

    // N일후
    const nDays = raw.match(/^(\d+)일\s*후$/);
    if (nDays) return addDays(parseInt(nDays[1]));

    // MM/DD → 올해 YYYY-MM-DD
    const mmdd = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (mmdd) {
      return `${today.getFullYear()}-${mmdd[1].padStart(2, "0")}-${mmdd[2].padStart(2, "0")}`;
    }

    // YYYY-MM-DD 그대로
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return raw;
  }

  private openRecurringTasksModal() {
    new RecurringTasksModal(
      this.app,
      this.settings,
      this.activeBoard,
      async () => {
        await this.saveSettings();
        await this.refresh();
      }
    ).open();
  }

  // ── 키보드 단축키 ─────────────────────────────────────────────────────────

  private handleKeydown(e: KeyboardEvent) {
    if (this.viewMode !== "board") return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;

    switch (e.key) {
      case "n":
      case "N": {
        e.preventDefault();
        const firstCol = this.activeBoard.columns[0];
        if (firstCol) this.openAddModal(firstCol.id);
        break;
      }
      case "e":
      case "E":
        if (this.selectedCard) { e.preventDefault(); this.openEditModal(this.selectedCard); }
        break;
      case "Delete":
        if (this.selectedCard) {
          e.preventDefault();
          const card = this.selectedCard;
          new ConfirmModal(this.app, {
            title: "카드 삭제",
            message: `"${card.title}" 카드를 삭제할까요?`,
            confirmText: "삭제",
            danger: true,
            onConfirm: async () => {
              await this.fileManager.deleteCard(card);
              this.selectedCard = null;
              await this.refresh();
            },
          }).open();
        }
        break;
      case "/":
        e.preventDefault();
        this.searchInputEl?.focus();
        break;
      case "Escape":
        if (this.selectedCard) { e.preventDefault(); this.closeDetailPanel(); }
        break;
    }
  }

  // ── 카드 상세 패널 ────────────────────────────────────────────────────────

  private openDetailPanel(card: KanbanCard) {
    this.selectedCard = card;
    this.containerEl.addClass("has-detail-panel");
    if (this.detailPanelEl) this.renderDetailPanel(card);
  }

  private closeDetailPanel() {
    this.selectedCard = null;
    this.containerEl.removeClass("has-detail-panel");
    if (this.detailPanelEl) {
      this.detailPanelEl.removeClass("is-open");
      this.detailPanelEl.empty();
    }
  }

  private renderDetailPanel(card: KanbanCard) {
    if (!this.detailPanelEl) return;
    this.detailPanelEl.empty();
    this.detailPanelEl.addClass("is-open");
    this.containerEl.addClass("has-detail-panel");

    // 헤더
    const panelHeader = this.detailPanelEl.createDiv("kanban-detail-header");
    panelHeader.createSpan({ text: "카드 상세", cls: "kanban-detail-header-title" });
    panelHeader.createEl("button", { text: "✕", cls: "kanban-detail-close-btn", title: "닫기 (Esc)" })
      .addEventListener("click", () => this.closeDetailPanel());

    // 바디
    const body = this.detailPanelEl.createDiv("kanban-detail-body");

    body.createDiv({ text: card.title, cls: "kanban-detail-card-title" });

    // 배지 (컬럼 + 우선순위 + 반복)
    const meta = body.createDiv("kanban-detail-meta");
    const colLabel = this.activeBoard.columns.find((c) => c.id === card.status)?.label ?? card.status;
    meta.createSpan({ text: colLabel, cls: "kanban-detail-badge kanban-detail-col-badge" });
    if (card.priority && card.priority !== "medium") {
      const pLabel: Record<string, string> = { low: "🔵 낮음", high: "🔴 높음", asap: "🚨 ASAP" };
      meta.createSpan({ text: pLabel[card.priority], cls: `kanban-detail-badge priority-badge-${card.priority}` });
    }
    if (card.recur) {
      const rLabel: Record<string, string> = { daily: "🔁 매일", weekly: "🔁 매주", monthly: "🔁 매월" };
      meta.createSpan({ text: rLabel[card.recur], cls: "kanban-detail-badge" });
    }

    // 마감일
    if (card.due) {
      const today = new Date().toISOString().split("T")[0];
      const overdue = card.due < today;
      body.createDiv({
        text: `📅 ${card.due}까지${overdue ? " (기한 초과)" : ""}`,
        cls: `kanban-detail-due${overdue ? " overdue" : ""}`,
      });
    }

    // 태그
    if (card.tags.length > 0) {
      const tagsEl = body.createDiv("kanban-detail-tags");
      for (const tag of card.tags) tagsEl.createSpan({ text: `#${tag}`, cls: "kanban-tag" });
    }

    body.createDiv({ cls: "kanban-detail-divider" });

    // 본문
    const { text: textContent, items: checklistItems } = parseChecklist(card.content);
    if (textContent) {
      const contentEl = body.createDiv("kanban-detail-content");
      this.renderContentWithLinks(contentEl, textContent, "");
    }

    // 체크리스트 (전체, 인터랙티브)
    if (checklistItems.length > 0) {
      const done = checklistItems.filter((i) => i.checked).length;
      const clSection = body.createDiv("kanban-detail-checklist-section");
      clSection.createDiv({ text: `체크리스트  ${done}/${checklistItems.length}`, cls: "kanban-detail-checklist-header" });
      for (let i = 0; i < checklistItems.length; i++) {
        const item = checklistItems[i];
        const itemEl = clSection.createDiv("kanban-card-checklist-item");
        const cb = itemEl.createEl("input");
        cb.type = "checkbox";
        cb.checked = item.checked;
        cb.className = "kanban-card-checklist-check";
        cb.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          checklistItems[i].checked = cb.checked;
          const newContent = [textContent, formatChecklist(checklistItems)].filter(Boolean).join("\n\n");
          await this.fileManager.updateCard({ ...card, content: newContent });
          await this.refresh();
        });
        const span = itemEl.createSpan({ cls: `kanban-card-checklist-text${item.checked ? " checked" : ""}` });
        this.renderContentWithLinks(span, item.text, "");
      }
    }

    // 날짜
    const createdMs = new Date(card.created).getTime();
    const datesEl = body.createDiv("kanban-detail-dates");
    datesEl.createSpan({ text: `생성 ${relativeTime(createdMs)}` });
    if (card.mtime && Math.abs(card.mtime - createdMs) > 60_000) {
      datesEl.createSpan({ text: " · " });
      datesEl.createSpan({ text: `수정 ${relativeTime(card.mtime)}` });
    }

    // 푸터 (편집 버튼 + 키보드 힌트)
    const footer = this.detailPanelEl.createDiv("kanban-detail-footer");
    footer.createEl("button", { text: "✎ 편집", cls: "mod-cta kanban-detail-edit-btn", title: "E" })
      .addEventListener("click", () => this.openEditModal(card));
    const hints = footer.createDiv("kanban-detail-kbd-hints");
    for (const { key, label } of [{ key: "E", label: "편집" }, { key: "Del", label: "삭제" }, { key: "Esc", label: "닫기" }]) {
      hints.createEl("kbd", { text: key, cls: "kanban-kbd" });
      hints.createSpan({ text: " " + label + "  " });
    }
  }

  // ── 헬퍼 ─────────────────────────────────────────────────────────────────

  private getFilteredArchived(): ArchivedCard[] {
    return this.archivedCards.filter((card) => {
      if (this.archiveMonthFilter && card.flushedAt.slice(0, 7) !== this.archiveMonthFilter) return false;
      if (this.archiveColumnFilter && card.flushedFrom !== this.archiveColumnFilter) return false;
      if (this.archiveTagFilter && !card.tags.includes(this.archiveTagFilter)) return false;
      if (this.archiveSearch) {
        const q = this.archiveSearch.toLowerCase();
        if (!card.title.toLowerCase().includes(q) &&
            !card.content.toLowerCase().includes(q) &&
            !card.tags.some((t) => t.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }

  private getArchiveMonths(): string[] {
    return [...new Set(this.archivedCards.map((c) => c.flushedAt.slice(0, 7)))].sort().reverse();
  }

  private getArchiveColumns(): string[] {
    return [...new Set(this.archivedCards.map((c) => c.flushedFrom))].sort();
  }

  private getArchiveTags(): string[] {
    const tags = new Set<string>();
    this.archivedCards.forEach((c) => c.tags.forEach((t) => tags.add(t)));
    return [...tags].sort();
  }

  private formatMonth(yyyyMM: string): string {
    const [y, m] = yyyyMM.split("-");
    return `${y}년 ${parseInt(m)}월`;
  }

  private renderContentWithLinks(parent: HTMLElement, text: string, query: string) {
    const linkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(text)) !== null) {
      if (match.index > last) this.highlightText(parent, text.slice(last, match.index), query);
      const target = match[1].trim();
      const alias = (match[2] ?? match[1]).trim();
      const linkEl = parent.createEl("span", { text: alias, cls: "kanban-internal-link" });
      linkEl.addEventListener("click", (e) => {
        e.stopPropagation();
        this.app.workspace.openLinkText(target, "", false);
      });
      last = match.index + match[0].length;
    }
    if (last < text.length) this.highlightText(parent, text.slice(last), query);
  }

  private highlightText(parent: HTMLElement, text: string, query: string) {
    if (!query) { parent.appendText(text); return; }
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let last = 0;
    let idx: number;
    while ((idx = lowerText.indexOf(lowerQuery, last)) !== -1) {
      if (idx > last) parent.appendText(text.slice(last, idx));
      parent.createSpan({ text: text.slice(idx, idx + lowerQuery.length), cls: "kanban-search-highlight" });
      last = idx + lowerQuery.length;
    }
    if (last < text.length) parent.appendText(text.slice(last));
  }

  async onClose() { this.containerEl.empty(); }
}

// ── RecurringTasksModal ───────────────────────────────────────────────────

class RecurringTasksModal extends Modal {
  constructor(
    app: App,
    private settings: KanbanSettings,
    private board: KanbanBoard,
    private onSave: () => Promise<void>
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("kanban-recurring-modal");
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "🔁 반복 작업 관리" });
    contentEl.createEl("p", {
      text: "Kanban 뷰를 열 때 설정한 주기가 지나면 카드를 자동으로 생성합니다.",
      cls: "kanban-recurring-desc",
    });

    const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

    const formatRecurLabel = (task: RecurringTask): string => {
      if (task.recur === "daily") return "매일";
      if (task.recur === "weekly") {
        if (task.dayOfWeek !== undefined) return `매주 ${DAY_NAMES[task.dayOfWeek]}요일`;
        return "매주";
      }
      if (task.recur === "monthly") {
        if (task.dayOfMonth !== undefined) return `매월 ${task.dayOfMonth}일`;
        return "매월";
      }
      return task.recur;
    };

    const tasks = this.settings.recurringTasks.filter((t) => t.boardId === this.board.id);

    if (tasks.length === 0) {
      contentEl.createDiv({ text: "등록된 반복 작업이 없습니다.", cls: "kanban-recurring-empty" });
    } else {
      const list = contentEl.createDiv("kanban-recurring-list");
      for (const task of tasks) {
        const row = list.createDiv("kanban-recurring-row");

        const info = row.createDiv("kanban-recurring-info");
        info.createDiv({ text: task.title, cls: "kanban-recurring-title" });

        const targetCol = this.board.columns.find((c) => c.id === task.targetColumnId)?.label ?? task.targetColumnId;
        const lastStr = task.lastCreated
          ? new Date(task.lastCreated).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
          : "아직 생성 안 됨";

        const metaParts = [formatRecurLabel(task), targetCol];
        if (task.priority) {
          const pLabel: Record<string, string> = { low: "🔵 낮음", medium: "🟡 중간", high: "🔴 높음", asap: "🚨 ASAP" };
          metaParts.push(pLabel[task.priority]);
        }
        if (task.dueDaysOffset) metaParts.push(`📅 +${task.dueDaysOffset}일`);
        if (task.checklist?.length) metaParts.push(`☑ ${task.checklist.length}개`);
        metaParts.push(`마지막 생성: ${lastStr}`);
        info.createDiv({ text: metaParts.join(" · "), cls: "kanban-recurring-meta" });

        const delBtn = row.createEl("button", { text: "삭제", cls: "kanban-recurring-del-btn mod-warning" });
        delBtn.addEventListener("click", async () => {
          this.settings.recurringTasks = this.settings.recurringTasks.filter((t) => t.id !== task.id);
          await this.onSave();
          this.render();
        });
      }
    }

    contentEl.createEl("hr");

    // 새 작업 추가 폼
    contentEl.createEl("h3", { text: "새 반복 작업 추가" });

    let newTitle = "";
    let newRecur: RecurringTask["recur"] = "weekly";
    let newDayOfWeek: number | undefined = undefined;
    let newDayOfMonth: number | undefined = undefined;
    let newTargetCol = this.board.columns.find((c) => !c.flushable)?.id ?? this.board.columns[0]?.id ?? "";
    let newPriority: RecurringTask["priority"] = undefined;
    let newDueDaysOffset = 0;
    let newContent = "";
    let newChecklist = ""; // 줄바꿈으로 구분

    new Setting(contentEl)
      .setName("작업 제목 *")
      .addText((t) => {
        t.setPlaceholder("예: 주간보고 작성").onChange((v) => (newTitle = v));
        t.inputEl.style.width = "100%";
      });

    const daySettingEl = contentEl.createDiv();

    const renderDaySetting = () => {
      daySettingEl.empty();
      if (newRecur === "weekly") {
        new Setting(daySettingEl)
          .setName("요일 지정")
          .addDropdown((dd) => {
            dd.addOption("", "매주 (7일마다)");
            for (let i = 0; i < 7; i++) dd.addOption(String(i), `매주 ${DAY_NAMES[i]}요일`);
            dd.setValue(newDayOfWeek !== undefined ? String(newDayOfWeek) : "");
            dd.onChange((v) => { newDayOfWeek = v === "" ? undefined : Number(v); });
          });
      } else if (newRecur === "monthly") {
        new Setting(daySettingEl)
          .setName("날짜 지정")
          .addDropdown((dd) => {
            dd.addOption("", "매월 (30일마다)");
            for (let d = 1; d <= 31; d++) dd.addOption(String(d), `매월 ${d}일`);
            dd.setValue(newDayOfMonth !== undefined ? String(newDayOfMonth) : "");
            dd.onChange((v) => { newDayOfMonth = v === "" ? undefined : Number(v); });
          });
      }
    };

    new Setting(contentEl)
      .setName("반복 주기")
      .addDropdown((dd) => {
        dd.addOption("daily", "매일");
        dd.addOption("weekly", "매주");
        dd.addOption("monthly", "매월");
        dd.setValue(newRecur);
        dd.onChange((v) => {
          newRecur = v as RecurringTask["recur"];
          newDayOfWeek = undefined;
          newDayOfMonth = undefined;
          renderDaySetting();
        });
      });

    // 반복 주기 설정 바로 다음에 요일/날짜 드롭다운 삽입
    contentEl.appendChild(daySettingEl);
    renderDaySetting();

    new Setting(contentEl)
      .setName("생성 컬럼")
      .addDropdown((dd) => {
        for (const col of this.board.columns) dd.addOption(col.id, col.label);
        dd.setValue(newTargetCol);
        dd.onChange((v) => (newTargetCol = v));
      });

    new Setting(contentEl)
      .setName("우선순위")
      .addDropdown((dd) => {
        dd.addOption("", "없음");
        dd.addOption("low",    "🔵 낮음");
        dd.addOption("medium", "🟡 중간");
        dd.addOption("high",   "🔴 높음");
        dd.addOption("asap",   "🚨 ASAP");
        dd.setValue(newPriority ?? "");
        dd.onChange((v) => { newPriority = (v || undefined) as RecurringTask["priority"]; });
      });

    new Setting(contentEl)
      .setName("마감일 오프셋")
      .setDesc("생성일 기준 N일 후 마감 (0 = 없음)")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "0";
        t.inputEl.style.width = "80px";
        t.setValue("0");
        t.onChange((v) => { newDueDaysOffset = Math.max(0, parseInt(v) || 0); });
      });

    new Setting(contentEl)
      .setName("내용")
      .addTextArea((area) => {
        area.setPlaceholder("카드 내용 (선택 사항)...").onChange((v) => (newContent = v));
        area.inputEl.rows = 3;
        area.inputEl.style.width = "100%";
      });

    new Setting(contentEl)
      .setName("체크리스트")
      .setDesc("한 줄에 한 항목씩 입력")
      .addTextArea((area) => {
        area.setPlaceholder("항목 1\n항목 2\n항목 3").onChange((v) => (newChecklist = v));
        area.inputEl.rows = 3;
        area.inputEl.style.width = "100%";
      });

    const addBtn = contentEl.createEl("button", { text: "추가", cls: "mod-cta" });
    addBtn.addEventListener("click", async () => {
      if (!newTitle.trim()) { new Notice("작업 제목을 입력하세요."); return; }
      const checklist = newChecklist.split("\n").map((s) => s.trim()).filter(Boolean);
      const task: RecurringTask = {
        id: `recur-${Date.now()}`,
        boardId: this.board.id,
        title: newTitle.trim(),
        tags: [],
        priority: newPriority,
        content: newContent.trim() || undefined,
        checklist: checklist.length > 0 ? checklist : undefined,
        dueDaysOffset: newDueDaysOffset > 0 ? newDueDaysOffset : undefined,
        recur: newRecur,
        dayOfWeek: newDayOfWeek,
        dayOfMonth: newDayOfMonth,
        targetColumnId: newTargetCol,
        lastCreated: undefined,
      };
      this.settings.recurringTasks.push(task);
      await this.onSave();
      new Notice(`"${task.title}" 반복 작업이 추가되었습니다.`);
      this.render();
    });
  }

  onClose() { this.contentEl.empty(); }
}
