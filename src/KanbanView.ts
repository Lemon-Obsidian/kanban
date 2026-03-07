import { ItemView, Menu, Notice, WorkspaceLeaf } from "obsidian";
import { COLUMN_CONFIG, ColumnStatus, KanbanCard, KanbanSettings } from "./types";
import { FileManager } from "./FileManager";
import { CardModal } from "./CardModal";

export const VIEW_TYPE_KANBAN = "kanban-board-view";

export class KanbanView extends ItemView {
  private cards: KanbanCard[] = [];
  private draggedCard: KanbanCard | null = null;
  private activeTagFilter: string | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private fileManager: FileManager,
    _settings: KanbanSettings
  ) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_KANBAN;
  }
  getDisplayText() {
    return "Kanban Board";
  }
  getIcon() {
    return "layout-kanban";
  }

  async onOpen() {
    await this.refresh();
  }

  async refresh() {
    this.cards = await this.fileManager.loadCards();
    this.render();
  }

  private render() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("kanban-container");

    // Header
    const header = containerEl.createDiv("kanban-header");
    header.createEl("h1", { text: "Kanban Board", cls: "kanban-title" });
    this.renderTagFilterBar(header);

    // Board columns
    const board = containerEl.createDiv("kanban-board");
    for (const col of COLUMN_CONFIG) {
      this.renderColumn(board, col.id, col.label);
    }
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
    allBtn.addEventListener("click", () => {
      this.activeTagFilter = null;
      this.render();
    });

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
    status: ColumnStatus,
    label: string
  ) {
    const filtered = this.getFilteredCards(status);

    const col = parent.createDiv("kanban-column");
    col.dataset.status = status;

    // Column header
    const colHeader = col.createDiv("kanban-column-header");
    colHeader.createEl("h2", { text: label, cls: "kanban-column-title" });
    colHeader.createDiv({
      text: String(filtered.length),
      cls: "kanban-column-count",
    });

    if (status === "todo") {
      const addBtn = colHeader.createEl("button", {
        text: "+",
        cls: "kanban-add-btn",
        title: "새 카드 추가",
      });
      addBtn.addEventListener("click", () => this.openAddModal());
    }

    // Cards area
    const cardsEl = col.createDiv("kanban-cards");

    cardsEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      cardsEl.addClass("drag-over");
    });
    cardsEl.addEventListener("dragleave", (e) => {
      if (!cardsEl.contains(e.relatedTarget as Node)) {
        cardsEl.removeClass("drag-over");
      }
    });
    cardsEl.addEventListener("drop", async (e) => {
      e.preventDefault();
      cardsEl.removeClass("drag-over");
      if (this.draggedCard && this.draggedCard.status !== status) {
        await this.fileManager.moveCard(this.draggedCard, status);
        this.draggedCard = null;
        await this.refresh();
      }
    });

    for (const card of filtered) {
      this.renderCard(cardsEl, card);
    }

    if (filtered.length === 0) {
      cardsEl.createDiv({
        text: "카드 없음",
        cls: "kanban-empty-col",
      });
    }
  }

  private getFilteredCards(status: ColumnStatus): KanbanCard[] {
    let cards = this.cards.filter((c) => c.status === status);
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
    cardEl.addEventListener("dragend", () => {
      cardEl.removeClass("dragging");
    });

    // Title
    cardEl.createDiv({ text: card.title, cls: "kanban-card-title" });

    // Due date
    if (card.due) {
      const today = new Date().toISOString().split("T")[0];
      const overdue = card.due < today && card.status !== "done";
      cardEl.createDiv({
        text: `📅 ${card.due}`,
        cls: `kanban-card-due ${overdue ? "overdue" : ""}`,
      });
    }

    // Content preview
    if (card.content) {
      const preview =
        card.content.length > 80
          ? card.content.slice(0, 80) + "..."
          : card.content;
      cardEl.createDiv({ text: preview, cls: "kanban-card-content" });
    }

    // Tags
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

    // Context menu (right-click)
    cardEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const menu = new Menu();

      menu.addItem((item) =>
        item
          .setTitle("편집")
          .setIcon("pencil")
          .onClick(() => this.openEditModal(card))
      );

      menu.addSeparator();

      if (card.status !== "todo")
        menu.addItem((item) =>
          item
            .setTitle("TO-DO로 이동")
            .setIcon("arrow-left")
            .onClick(() => this.moveCard(card, "todo"))
        );
      if (card.status !== "doing")
        menu.addItem((item) =>
          item
            .setTitle("IN PROGRESS로 이동")
            .setIcon("arrow-right")
            .onClick(() => this.moveCard(card, "doing"))
        );
      if (card.status !== "done")
        menu.addItem((item) =>
          item
            .setTitle("DONE으로 이동")
            .setIcon("check")
            .onClick(() => this.moveCard(card, "done"))
        );

      menu.addSeparator();

      menu.addItem((item) =>
        item
          .setTitle("삭제")
          .setIcon("trash")
          .onClick(async () => {
            if (confirm(`"${card.title}" 카드를 삭제할까요?`)) {
              await this.fileManager.deleteCard(card);
              await this.refresh();
            }
          })
      );

      menu.showAtMouseEvent(e);
    });

    // Click = edit
    cardEl.addEventListener("click", () => this.openEditModal(card));
  }

  private openAddModal() {
    new CardModal(this.app, {
      onSubmit: async (data) => {
        await this.fileManager.createCard({ ...data, status: "todo" });
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

  private async moveCard(card: KanbanCard, newStatus: ColumnStatus) {
    await this.fileManager.moveCard(card, newStatus);
    await this.refresh();
  }

  async onClose() {
    this.containerEl.empty();
  }
}
