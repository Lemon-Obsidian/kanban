import { ItemView, Menu, Modal, Notice, Setting, WorkspaceLeaf } from "obsidian";
import { ArchivedCard, KanbanCard, KanbanColumn, KanbanSettings } from "./types";
import { FileManager } from "./FileManager";
import { CardModal } from "./CardModal";
import { slugify, parseChecklist, formatChecklist, priorityToNum } from "./utils";

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

  private viewMode: ViewMode = "board";
  private archivedCards: ArchivedCard[] = [];
  private archiveSearch = "";
  private archiveMonthFilter: string | null = null;
  private archiveColumnFilter: string | null = null;
  private archiveTagFilter: string | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private fileManager: FileManager,
    private settings: KanbanSettings,
    private saveSettings: () => Promise<void>
  ) {
    super(leaf);
  }

  getViewType() { return VIEW_TYPE_KANBAN; }
  getDisplayText() { return "Kanban Board"; }
  getIcon() { return "columns"; }

  async onOpen() { await this.refresh(); }

  async refresh() {
    if (this.viewMode === "board" || this.viewMode === "upcoming") {
      this.cards = await this.fileManager.loadCards();
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
    containerEl.addClass("kanban-container");

    const header = containerEl.createDiv("kanban-header");

    const titleRow = header.createDiv("kanban-header-title-row");
    titleRow.createEl("h1", { text: "Kanban Board", cls: "kanban-title" });

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

    // 검색 + 정렬
    const controlsRow = header.createDiv("kanban-controls-row");

    const searchInput = controlsRow.createEl("input", {
      type: "text",
      cls: "kanban-search-input",
    });
    searchInput.placeholder = "🔍  카드 검색 (제목, 내용, 태그)...";
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

    this.boardColumnsEl = containerEl.createDiv("kanban-board");
    this.renderBoardColumns();
  }

  private renderBoardColumns() {
    if (!this.boardColumnsEl) return;
    this.boardColumnsEl.empty();

    for (const col of this.settings.columns) {
      this.renderColumn(this.boardColumnsEl, col.id, col.label, col.flushable ?? false);
    }

    const addColPlaceholder = this.boardColumnsEl.createDiv("kanban-add-column-placeholder");
    addColPlaceholder.createDiv({ text: "+", cls: "kanban-add-column-plus" });
    addColPlaceholder.createDiv({ text: "컬럼 추가", cls: "kanban-add-column-label" });
    addColPlaceholder.addEventListener("click", () => {
      new AddColumnModal(
        this.app,
        this.settings.columns.map((c) => c.id),
        async (newCol) => {
          this.settings.columns.push(newCol);
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

    bar.createEl("button", {
      text: "전체",
      cls: `kanban-tag-btn${this.activeTagFilter === null ? " active" : ""}`,
    }).addEventListener("click", () => { this.activeTagFilter = null; this.render(); });

    for (const tag of [...allTags].sort()) {
      bar.createEl("button", {
        text: `#${tag}`,
        cls: `kanban-tag-btn${this.activeTagFilter === tag ? " active" : ""}`,
      }).addEventListener("click", () => {
        this.activeTagFilter = this.activeTagFilter === tag ? null : tag;
        this.render();
      });
    }
  }

  private renderColumn(parent: HTMLElement, columnId: string, label: string, flushable: boolean) {
    const allCards = this.getFilteredCards(columnId);

    const col = parent.createDiv("kanban-column");
    col.dataset.status = columnId;

    // 헤더
    const colHeader = col.createDiv("kanban-column-header");
    const colHeaderLeft = colHeader.createDiv("kanban-column-header-left");
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
        item.setTitle("컬럼 삭제").setIcon("trash").onClick(() => {
          if (this.settings.columns.length <= 1) {
            new Notice("최소 1개의 컬럼이 필요합니다.");
            return;
          }
          if (allCards.length > 0) {
            new Notice(`카드 ${allCards.length}개를 먼저 이동하거나 보관하세요.`);
            return;
          }
          new ConfirmModal(this.app, {
            title: "컬럼 삭제",
            message: `"${label}" 컬럼을 삭제할까요?`,
            confirmText: "삭제",
            danger: true,
            onConfirm: async () => {
              this.settings.columns = this.settings.columns.filter((c) => c.id !== columnId);
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

    cardsEl.addEventListener("dragover", (e) => { e.preventDefault(); col.addClass("drag-over"); });
    cardsEl.addEventListener("dragleave", (e) => {
      if (!col.contains(e.relatedTarget as Node)) col.removeClass("drag-over");
    });
    cardsEl.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.removeClass("drag-over");
      if (this.draggedCard && this.draggedCard.status !== columnId) {
        await this.fileManager.moveCard(this.draggedCard, columnId);
        this.draggedCard = null;
        await this.refresh();
      }
    });

    if (allCards.length === 0) {
      cardsEl.createDiv({ text: "카드 없음", cls: "kanban-empty-col" });
    } else {
      for (const card of allCards) this.renderCard(cardsEl, card);
    }

    // 퀵 추가
    const quickAddEl = col.createDiv("kanban-quick-add");
    const quickInput = quickAddEl.createEl("input", {
      type: "text",
      cls: "kanban-quick-add-input",
    });
    quickInput.placeholder = "+ 카드 추가...";
    quickInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        const title = quickInput.value.trim();
        if (!title) return;
        await this.fileManager.createCard({
          title,
          tags: [],
          priority: "medium",
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

    // 제목
    cardEl.createDiv({ text: card.title, cls: "kanban-card-title" });

    // 마감일
    if (card.due) {
      const today = new Date().toISOString().split("T")[0];
      const overdue = card.due < today;
      cardEl.createDiv({
        text: `${overdue ? "⚠ 기한 초과 · " : "📅 "}${card.due}`,
        cls: `kanban-card-due${overdue ? " overdue" : ""}`,
      });
    }

    // 텍스트 미리보기 + 체크리스트
    const { text: textContent, items: checklistItems } = parseChecklist(card.content);
    if (textContent) {
      const preview = textContent.length > 100 ? textContent.slice(0, 100) + "..." : textContent;
      cardEl.createDiv({ text: preview, cls: "kanban-card-content" });
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

        itemEl.createSpan({
          text: item.text,
          cls: `kanban-card-checklist-text${item.checked ? " checked" : ""}`,
        });
      }
    }

    // 태그
    if (card.tags.length > 0) {
      const tagsEl = cardEl.createDiv("kanban-card-tags");
      for (const tag of card.tags) {
        tagsEl.createEl("span", {
          text: `#${tag}`,
          cls: `kanban-tag${this.activeTagFilter === tag ? " active" : ""}`,
        }).addEventListener("click", (e) => {
          e.stopPropagation();
          this.activeTagFilter = this.activeTagFilter === tag ? null : tag;
          this.render();
        });
      }
    }

    // 우클릭 컨텍스트 메뉴
    cardEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle("편집").setIcon("pencil").onClick(() => this.openEditModal(card))
      );
      menu.addSeparator();
      for (const col of this.settings.columns) {
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

    cardEl.addEventListener("click", () => this.openEditModal(card));
  }

  private openAddModal(columnId: string) {
    new CardModal(this.app, {
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
    this.cards = await this.fileManager.loadCards();
    this.render();
  }

  private renderUpcoming() {
    const { containerEl } = this;
    containerEl.empty();
    this.boardColumnsEl = null;
    containerEl.addClass("kanban-container");

    const header = containerEl.createDiv("kanban-header");
    const titleRow = header.createDiv("kanban-header-title-row");
    titleRow.createEl("button", { text: "← 보드로 돌아가기", cls: "kanban-back-btn" })
      .addEventListener("click", () => this.switchToBoard());
    titleRow.createEl("h2", { text: "📅 마감 임박", cls: "kanban-view-title" });

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const todayStr = todayDate.toISOString().split("T")[0];
    const weekDate = new Date(todayDate); weekDate.setDate(weekDate.getDate() + 7);
    const weekStr = weekDate.toISOString().split("T")[0];
    const monthDate = new Date(todayDate); monthDate.setDate(monthDate.getDate() + 30);
    const monthStr = monthDate.toISOString().split("T")[0];

    const activeColumnIds = new Set(this.settings.columns.map((c) => c.id));
    const cardsWithDue = this.cards.filter((c) => c.due && activeColumnIds.has(c.status));

    const groups = [
      { key: "overdue", label: "기한 초과", cards: cardsWithDue.filter((c) => c.due! < todayStr) },
      { key: "today",   label: "오늘",      cards: cardsWithDue.filter((c) => c.due === todayStr) },
      { key: "week",    label: "이번 주 (7일 이내)",  cards: cardsWithDue.filter((c) => c.due! > todayStr && c.due! <= weekStr) },
      { key: "month",   label: "이번 달 (30일 이내)", cards: cardsWithDue.filter((c) => c.due! > weekStr && c.due! <= monthStr) },
      { key: "later",   label: "이후",      cards: cardsWithDue.filter((c) => c.due! > monthStr) },
    ];

    const content = containerEl.createDiv("kanban-list-content");
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

  private renderArchive() {
    const { containerEl } = this;
    containerEl.empty();
    this.boardColumnsEl = null;
    containerEl.addClass("kanban-container");

    const header = containerEl.createDiv("kanban-header");
    const titleRow = header.createDiv("kanban-header-title-row");
    titleRow.createEl("button", { text: "← 보드로 돌아가기", cls: "kanban-back-btn" })
      .addEventListener("click", () => this.switchToBoard());
    titleRow.createEl("h2", { text: "🗃 아카이브 히스토리", cls: "kanban-view-title" });

    const searchInput = header.createEl("input", {
      type: "text",
      placeholder: "🔍  제목, 내용, 태그 검색...",
      cls: "kanban-search-input",
    });
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
      (id) => this.settings.columns.find((c) => c.id === id)?.label ?? id);
    this.renderArchiveFilterRow(filterBar, "태그", this.getArchiveTags(), this.archiveTagFilter,
      (v) => { this.archiveTagFilter = v; this.renderArchiveContent(content); },
      (t) => `#${t}`);

    const content = containerEl.createDiv("kanban-list-content");
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
    const colLabel = this.settings.columns.find((c) => c.id === colId)?.label ?? colId;
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
      metaRow.createSpan({
        text: `☑ ${checked}/${checklistItems.length}`,
        cls: `kanban-checklist-progress${checked === checklistItems.length ? " complete" : ""}`,
      });
    }

    cardEl.addEventListener("click", () => {
      if (flushedAt) {
        new CardModal(this.app, {
          card,
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

  async onClose() { this.containerEl.empty(); }
}
