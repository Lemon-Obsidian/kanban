import { ItemView, Menu, Modal, Notice, Setting, WorkspaceLeaf } from "obsidian";
import { ArchivedCard, KanbanCard, KanbanColumn, KanbanSettings } from "./types";
import { FileManager } from "./FileManager";
import { CardModal } from "./CardModal";
import { slugify } from "./utils";

export const VIEW_TYPE_KANBAN = "kanban-board-view";

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

// ── Flush 확인 모달 ───────────────────────────────────────────────────────

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
    confirmBtn.addEventListener("click", () => {
      this.onConfirm();
      this.close();
    });
  }

  onClose() { this.contentEl.empty(); }
}

// ── KanbanView ────────────────────────────────────────────────────────────

type ViewMode = "board" | "archive";

export class KanbanView extends ItemView {
  // Board state
  private cards: KanbanCard[] = [];
  private draggedCard: KanbanCard | null = null;
  private activeTagFilter: string | null = null;

  // Archive state
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
    if (this.viewMode === "board") {
      this.cards = await this.fileManager.loadCards();
    } else {
      this.archivedCards = await this.fileManager.loadArchivedCards();
    }
    this.render();
  }

  private render() {
    if (this.viewMode === "board") this.renderBoard();
    else this.renderArchive();
  }

  // ── 보드 뷰 ─────────────────────────────────────────────────────────────

  private renderBoard() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("kanban-container");

    const header = containerEl.createDiv("kanban-header");

    const titleRow = header.createDiv("kanban-header-title-row");
    titleRow.createEl("h1", { text: "Kanban Board", cls: "kanban-title" });

    const archiveBtn = titleRow.createEl("button", {
      text: "아카이브",
      cls: "kanban-archive-open-btn",
      title: "아카이브 히스토리 보기",
    });
    archiveBtn.addEventListener("click", () => this.switchToArchive());

    this.renderTagFilterBar(header);

    const board = containerEl.createDiv("kanban-board");
    for (const col of this.settings.columns) {
      this.renderColumn(board, col.id, col.label, col.flushable ?? false);
    }

    // + 컬럼 추가 버튼
    const addColPlaceholder = board.createDiv("kanban-add-column-placeholder");
    addColPlaceholder.createDiv({ text: "+ 컬럼 추가", cls: "kanban-add-column-label" });
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
    bar.createSpan({ text: "태그 필터: ", cls: "kanban-filter-label" });

    const allBtn = bar.createEl("button", {
      text: "전체",
      cls: `kanban-tag-btn ${this.activeTagFilter === null ? "active" : ""}`,
    });
    allBtn.addEventListener("click", () => { this.activeTagFilter = null; this.render(); });

    for (const tag of [...allTags].sort()) {
      const btn = bar.createEl("button", {
        text: `#${tag}`,
        cls: `kanban-tag-btn ${this.activeTagFilter === tag ? "active" : ""}`,
      });
      btn.addEventListener("click", () => {
        this.activeTagFilter = this.activeTagFilter === tag ? null : tag;
        this.render();
      });
    }
  }

  private renderColumn(
    parent: HTMLElement,
    columnId: string,
    label: string,
    flushable: boolean
  ) {
    const filtered = this.getFilteredCards(columnId);

    const col = parent.createDiv("kanban-column");
    col.dataset.status = columnId;

    const colHeader = col.createDiv("kanban-column-header");
    colHeader.createEl("h2", { text: label, cls: "kanban-column-title" });
    colHeader.createDiv({ text: String(filtered.length), cls: "kanban-column-count" });

    if (flushable && filtered.length > 0) {
      const flushBtn = colHeader.createEl("button", {
        text: `🗃 보관 (${filtered.length})`,
        cls: "kanban-flush-btn",
        title: "카드를 아카이브로 보관",
      });
      flushBtn.addEventListener("click", () => this.openFlushModal(columnId, label, filtered.length));
    }

    const addBtn = colHeader.createEl("button", {
      text: "+",
      cls: "kanban-add-btn",
      title: "새 카드 추가",
    });
    addBtn.addEventListener("click", () => this.openAddModal(columnId));

    // 컬럼 옵션 메뉴 (···)
    const menuBtn = colHeader.createEl("button", {
      text: "···",
      cls: "kanban-col-menu-btn",
      title: "컬럼 옵션",
    });
    menuBtn.addEventListener("click", (e) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle("컬럼 삭제")
          .setIcon("trash")
          .onClick(async () => {
            if (this.settings.columns.length <= 1) {
              new Notice("최소 1개의 컬럼이 필요합니다.");
              return;
            }
            if (filtered.length > 0) {
              new Notice(`카드 ${filtered.length}개를 먼저 이동하거나 보관하세요.`);
              return;
            }
            if (!confirm(`"${label}" 컬럼을 삭제할까요?`)) return;
            this.settings.columns = this.settings.columns.filter((c) => c.id !== columnId);
            await this.saveSettings();
            await this.refresh();
            new Notice(`"${label}" 컬럼이 삭제되었습니다.`);
          })
      );
      menu.showAtMouseEvent(e);
    });

    const cardsEl = col.createDiv("kanban-cards");

    cardsEl.addEventListener("dragover", (e) => { e.preventDefault(); cardsEl.addClass("drag-over"); });
    cardsEl.addEventListener("dragleave", (e) => {
      if (!cardsEl.contains(e.relatedTarget as Node)) cardsEl.removeClass("drag-over");
    });
    cardsEl.addEventListener("drop", async (e) => {
      e.preventDefault();
      cardsEl.removeClass("drag-over");
      if (this.draggedCard && this.draggedCard.status !== columnId) {
        await this.fileManager.moveCard(this.draggedCard, columnId);
        this.draggedCard = null;
        await this.refresh();
      }
    });

    for (const card of filtered) this.renderCard(cardsEl, card);

    if (filtered.length === 0) {
      cardsEl.createDiv({ text: "카드 없음", cls: "kanban-empty-col" });
    }
  }

  private getFilteredCards(columnId: string): KanbanCard[] {
    let cards = this.cards.filter((c) => c.status === columnId);
    if (this.activeTagFilter) {
      cards = cards.filter((c) => c.tags.includes(this.activeTagFilter!));
    }
    return cards;
  }

  private renderCard(parent: HTMLElement, card: KanbanCard) {
    const cardEl = parent.createDiv("kanban-card");
    if (card.priority) cardEl.addClass(`priority-${card.priority}`);
    cardEl.draggable = true;

    cardEl.addEventListener("dragstart", () => {
      this.draggedCard = card;
      setTimeout(() => cardEl.addClass("dragging"), 0);
    });
    cardEl.addEventListener("dragend", () => cardEl.removeClass("dragging"));

    cardEl.createDiv({ text: card.title, cls: "kanban-card-title" });

    if (card.due) {
      const today = new Date().toISOString().split("T")[0];
      const overdue = card.due < today && card.status !== "done";
      cardEl.createDiv({
        text: `📅 ${card.due}`,
        cls: `kanban-card-due ${overdue ? "overdue" : ""}`,
      });
    }

    if (card.content) {
      const preview = card.content.length > 80 ? card.content.slice(0, 80) + "..." : card.content;
      cardEl.createDiv({ text: preview, cls: "kanban-card-content" });
    }

    if (card.tags.length > 0) {
      const tagsEl = cardEl.createDiv("kanban-card-tags");
      for (const tag of card.tags) {
        const tagEl = tagsEl.createEl("span", {
          text: `#${tag}`,
          cls: `kanban-tag ${this.activeTagFilter === tag ? "active" : ""}`,
        });
        tagEl.addEventListener("click", (e) => {
          e.stopPropagation();
          this.activeTagFilter = this.activeTagFilter === tag ? null : tag;
          this.render();
        });
      }
    }

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
          item
            .setTitle(`${col.label}(으)로 이동`)
            .setIcon("arrow-right")
            .onClick(() => this.moveCard(card, col.id))
        );
      }
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle("삭제").setIcon("trash").onClick(async () => {
          if (confirm(`"${card.title}" 카드를 삭제할까요?`)) {
            await this.fileManager.deleteCard(card);
            await this.refresh();
          }
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
    this.render();
  }

  private renderArchive() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("kanban-container");

    // 헤더
    const header = containerEl.createDiv("kanban-header kanban-archive-header");

    const backBtn = header.createEl("button", {
      text: "← 보드로 돌아가기",
      cls: "kanban-back-btn",
    });
    backBtn.addEventListener("click", () => this.switchToBoard());

    header.createEl("h2", { text: "아카이브 히스토리", cls: "kanban-archive-title" });

    // 검색창
    const searchWrap = header.createDiv("kanban-archive-search-wrap");
    const searchInput = searchWrap.createEl("input", {
      type: "text",
      placeholder: "제목, 내용, 태그 검색...",
      cls: "kanban-archive-search",
    });
    searchInput.value = this.archiveSearch;
    searchInput.addEventListener("input", (e) => {
      this.archiveSearch = (e.target as HTMLInputElement).value;
      this.renderArchiveContent(content);
    });

    // 필터 바
    const filterBar = header.createDiv("kanban-archive-filters");
    this.renderArchiveFilterRow(filterBar, "월", this.getArchiveMonths(), this.archiveMonthFilter, (v) => {
      this.archiveMonthFilter = v;
      this.renderArchiveContent(content);
    }, (m) => this.formatMonth(m));

    this.renderArchiveFilterRow(filterBar, "컬럼", this.getArchiveColumns(), this.archiveColumnFilter, (v) => {
      this.archiveColumnFilter = v;
      this.renderArchiveContent(content);
    }, (id) => this.settings.columns.find((c) => c.id === id)?.label ?? id);

    this.renderArchiveFilterRow(filterBar, "태그", this.getArchiveTags(), this.archiveTagFilter, (v) => {
      this.archiveTagFilter = v;
      this.renderArchiveContent(content);
    }, (t) => `#${t}`);

    // 카드 목록 영역
    const content = containerEl.createDiv("kanban-archive-content");
    this.renderArchiveContent(content);
  }

  private renderArchiveFilterRow(
    parent: HTMLElement,
    label: string,
    values: string[],
    active: string | null,
    onChange: (v: string | null) => void,
    format: (v: string) => string
  ) {
    if (values.length === 0) return;
    const row = parent.createDiv("kanban-archive-filter-row");
    row.createSpan({ text: `${label}: `, cls: "kanban-filter-label" });

    const allBtn = row.createEl("button", {
      text: "전체",
      cls: `kanban-tag-btn ${active === null ? "active" : ""}`,
    });
    allBtn.addEventListener("click", () => { onChange(null); this.renderArchive(); });

    for (const v of values) {
      const btn = row.createEl("button", {
        text: format(v),
        cls: `kanban-tag-btn ${active === v ? "active" : ""}`,
      });
      btn.addEventListener("click", () => { onChange(v); this.renderArchive(); });
    }
  }

  private renderArchiveContent(container: HTMLElement) {
    container.empty();

    const filtered = this.getFilteredArchived();

    if (filtered.length === 0) {
      container.createDiv({ text: "아카이브된 카드가 없습니다.", cls: "kanban-empty" });
      return;
    }

    // 월별 그룹핑
    const groups = new Map<string, ArchivedCard[]>();
    for (const card of filtered) {
      const month = card.flushedAt.slice(0, 7);
      if (!groups.has(month)) groups.set(month, []);
      groups.get(month)!.push(card);
    }

    for (const [month, cards] of [...groups.entries()].sort().reverse()) {
      const section = container.createDiv("kanban-archive-section");
      section.createEl("h3", {
        text: `${this.formatMonth(month)} (${cards.length}개)`,
        cls: "kanban-archive-month-title",
      });

      for (const card of cards) {
        this.renderArchiveCard(section, card);
      }
    }
  }

  private renderArchiveCard(parent: HTMLElement, card: ArchivedCard) {
    const colLabel =
      this.settings.columns.find((c) => c.id === card.flushedFrom)?.label ?? card.flushedFrom;
    const priorityIcon: Record<string, string> = { low: "🔵", medium: "🟡", high: "🔴" };
    const flushedDate = new Date(card.flushedAt).toLocaleDateString("ko-KR");

    const cardEl = parent.createDiv("kanban-archive-card");

    const topRow = cardEl.createDiv("kanban-archive-card-top");
    topRow.createSpan({ text: colLabel, cls: `kanban-status-badge status-${card.flushedFrom}` });
    topRow.createSpan({ text: card.title, cls: "kanban-archive-card-title" });
    if (card.priority) topRow.createSpan({ text: priorityIcon[card.priority] });

    const metaRow = cardEl.createDiv("kanban-archive-card-meta");
    if (card.due) metaRow.createSpan({ text: `📅 ${card.due}`, cls: "kanban-tag" });
    metaRow.createSpan({ text: `🗃 ${flushedDate} flush`, cls: "kanban-archive-flush-date" });
    for (const tag of card.tags) {
      metaRow.createSpan({ text: `#${tag}`, cls: "kanban-tag" });
    }

    if (card.content) {
      const preview = card.content.length > 100 ? card.content.slice(0, 100) + "..." : card.content;
      cardEl.createDiv({ text: preview, cls: "kanban-card-content" });
    }

    cardEl.addEventListener("click", () => {
      new CardModal(this.app, {
        card,
        onSubmit: async (data) => {
          await this.fileManager.updateArchivedCard({ ...card, ...data });
          this.archivedCards = await this.fileManager.loadArchivedCards();
          this.renderArchive();
          new Notice("카드가 수정되었습니다!");
        },
      }).open();
    });
  }

  // ── 아카이브 필터 헬퍼 ───────────────────────────────────────────────────

  private getFilteredArchived(): ArchivedCard[] {
    return this.archivedCards.filter((card) => {
      if (this.archiveMonthFilter && card.flushedAt.slice(0, 7) !== this.archiveMonthFilter)
        return false;
      if (this.archiveColumnFilter && card.flushedFrom !== this.archiveColumnFilter)
        return false;
      if (this.archiveTagFilter && !card.tags.includes(this.archiveTagFilter))
        return false;
      if (this.archiveSearch) {
        const q = this.archiveSearch.toLowerCase();
        const hit =
          card.title.toLowerCase().includes(q) ||
          card.content.toLowerCase().includes(q) ||
          card.tags.some((t) => t.toLowerCase().includes(q));
        if (!hit) return false;
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
