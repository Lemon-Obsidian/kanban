import { App, Modal, Setting } from "obsidian";
import { KanbanCard } from "./types";
import { parseTags, formatTags } from "./utils";

interface CardModalOptions {
  card?: KanbanCard;
  onSubmit: (data: Omit<KanbanCard, "filePath">) => void;
}

export class CardModal extends Modal {
  private title = "";
  private tags = "";
  private due = "";
  private priority: "" | "low" | "medium" | "high" = "";
  private content = "";

  constructor(app: App, private options: CardModalOptions) {
    super(app);
    if (options.card) {
      this.title = options.card.title;
      this.tags = formatTags(options.card.tags);
      this.due = options.card.due ?? "";
      this.priority = options.card.priority ?? "";
      this.content = options.card.content;
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("kanban-card-modal");

    contentEl.createEl("h2", {
      text: this.options.card ? "카드 편집" : "새 카드 추가",
    });

    // Title
    let titleInput: HTMLInputElement;
    new Setting(contentEl)
      .setName("제목 *")
      .addText((text) => {
        text
          .setPlaceholder("카드 제목...")
          .setValue(this.title)
          .onChange((v) => (this.title = v));
        text.inputEl.style.width = "100%";
        titleInput = text.inputEl;
      });

    // Tags
    new Setting(contentEl)
      .setName("태그")
      .setDesc("#태그1 #태그2 형식으로 입력")
      .addText((text) => {
        text
          .setPlaceholder("#업무 #프로젝트...")
          .setValue(this.tags)
          .onChange((v) => (this.tags = v));
        text.inputEl.style.width = "100%";
      });

    // Due date
    new Setting(contentEl).setName("마감일").addText((text) => {
      text.inputEl.type = "date";
      text.setValue(this.due).onChange((v) => (this.due = v));
    });

    // Priority
    new Setting(contentEl).setName("우선순위").addDropdown((drop) => {
      drop
        .addOption("", "없음")
        .addOption("low", "낮음 🔵")
        .addOption("medium", "보통 🟡")
        .addOption("high", "높음 🔴")
        .setValue(this.priority)
        .onChange((v) => (this.priority = v as typeof this.priority));
    });

    // Content
    new Setting(contentEl).setName("내용").addTextArea((area) => {
      area
        .setPlaceholder("카드 내용 (선택 사항)...")
        .setValue(this.content)
        .onChange((v) => (this.content = v));
      area.inputEl.rows = 5;
      area.inputEl.style.width = "100%";
    });

    // Buttons
    const btnRow = contentEl.createDiv("kanban-modal-buttons");

    const cancelBtn = btnRow.createEl("button", { text: "취소" });
    cancelBtn.addEventListener("click", () => this.close());

    const submitBtn = btnRow.createEl("button", {
      text: this.options.card ? "저장" : "추가",
      cls: "mod-cta",
    });
    submitBtn.addEventListener("click", () => {
      if (!this.title.trim()) {
        titleInput.style.outline = "2px solid red";
        titleInput.focus();
        return;
      }
      this.options.onSubmit({
        title: this.title.trim(),
        tags: parseTags(this.tags),
        due: this.due || undefined,
        priority: this.priority || undefined,
        created: this.options.card?.created ?? new Date().toISOString(),
        content: this.content,
        status: this.options.card?.status ?? "todo",
      });
      this.close();
    });

    // Submit on Enter in title field
    titleInput!.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitBtn.click();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
