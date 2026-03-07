import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { KanbanCard, KanbanSettings } from "./types";
import { FileManager } from "./FileManager";
import { CardModal } from "./CardModal";

export const VIEW_TYPE_TAG_GROUP = "kanban-tag-group-view";

export class TagGroupView extends ItemView {
  private cards: KanbanCard[] = [];
  private statusFilter = "all";
  private expandedTags = new Set<string>();

  constructor(
    leaf: WorkspaceLeaf,
    private fileManager: FileManager,
    private settings: KanbanSettings
  ) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_TAG_GROUP;
  }
  getDisplayText() {
    return "태그별 보기";
  }
  getIcon() {
    return "tag";
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
    containerEl.addClass("kanban-tag-group-container");

    const header = containerEl.createDiv("kanban-tag-group-header");
    header.createEl("h2", { text: "태그별 카드 보기" });

    // Status filter: 전체 + 각 컬럼
    const filterRow = header.createDiv("kanban-status-filter");

    const allBtn = filterRow.createEl("button", {
      text: "전체",
      cls: `kanban-status-btn ${this.statusFilter === "all" ? "active" : ""}`,
    });
    allBtn.addEventListener("click", () => {
      this.statusFilter = "all";
      this.render();
    });

    for (const col of this.settings.columns) {
      const btn = filterRow.createEl("button", {
        text: col.label,
        cls: `kanban-status-btn ${this.statusFilter === col.id ? "active" : ""}`,
      });
      btn.addEventListener("click", () => {
        this.statusFilter = col.id;
        this.render();
      });
    }

    // Build tag groups
    const filtered =
      this.statusFilter === "all"
        ? this.cards
        : this.cards.filter((c) => c.status === this.statusFilter);

    const tagGroups = new Map<string, KanbanCard[]>();
    const untagged: KanbanCard[] = [];

    for (const card of filtered) {
      if (card.tags.length === 0) {
        untagged.push(card);
      } else {
        for (const tag of card.tags) {
          if (!tagGroups.has(tag)) tagGroups.set(tag, []);
          tagGroups.get(tag)!.push(card);
        }
      }
    }

    const content = containerEl.createDiv("kanban-tag-groups");

    if (tagGroups.size === 0 && untagged.length === 0) {
      content.createDiv({ text: "카드가 없습니다.", cls: "kanban-empty" });
      return;
    }

    for (const [tag, cards] of [...tagGroups.entries()].sort()) {
      this.renderTagGroup(content, tag, cards);
    }

    if (untagged.length > 0) {
      this.renderTagGroup(content, null, untagged);
    }
  }

  private renderTagGroup(
    parent: HTMLElement,
    tag: string | null,
    cards: KanbanCard[]
  ) {
    const key = tag ?? "__untagged__";
    const isExpanded = this.expandedTags.has(key);

    const group = parent.createDiv("kanban-tag-group");

    const groupHeader = group.createDiv("kanban-tag-group-title");
    const arrow = groupHeader.createSpan({ text: isExpanded ? "▼ " : "▶ " });
    groupHeader.createEl("strong", { text: tag ? `#${tag}` : "태그 없음" });
    groupHeader.createSpan({
      text: ` (${cards.length})`,
      cls: "kanban-tag-count",
    });

    const cardList = group.createDiv("kanban-tag-card-list");
    if (!isExpanded) cardList.style.display = "none";

    groupHeader.addEventListener("click", () => {
      if (this.expandedTags.has(key)) {
        this.expandedTags.delete(key);
        cardList.style.display = "none";
        arrow.textContent = "▶ ";
      } else {
        this.expandedTags.add(key);
        cardList.style.display = "block";
        arrow.textContent = "▼ ";
      }
    });

    // Column id → label 맵
    const columnLabel = Object.fromEntries(
      this.settings.columns.map((c) => [c.id, c.label])
    );
    const priorityIcon: Record<string, string> = {
      low: "🔵",
      medium: "🟡",
      high: "🔴",
      asap: "🚨",
    };

    for (const card of cards) {
      const row = cardList.createDiv("kanban-tag-card-item");

      row.createSpan({
        text: columnLabel[card.status] ?? card.status,
        cls: `kanban-status-badge status-${card.status}`,
      });

      row.createSpan({ text: card.title, cls: "kanban-tag-card-title" });

      if (card.due) {
        row.createSpan({ text: `📅 ${card.due}`, cls: "kanban-tag-card-due" });
      }

      if (card.priority) {
        row.createSpan({
          text: priorityIcon[card.priority],
          cls: "kanban-tag-card-priority",
        });
      }

      row.addEventListener("click", () => {
        new CardModal(this.app, {
          card,
          onSubmit: async (data) => {
            await this.fileManager.updateCard({ ...card, ...data });
            await this.refresh();
            new Notice("카드가 수정되었습니다!");
          },
        }).open();
      });
    }
  }

  async onClose() {
    this.containerEl.empty();
  }
}
