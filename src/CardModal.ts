import { App, Modal, Setting } from "obsidian";
import { KanbanCard } from "./types";
import { parseTags, formatTags, ChecklistItem, parseChecklist, formatChecklist } from "./utils";

interface CardModalOptions {
  card?: KanbanCard;
  onSubmit: (data: Omit<KanbanCard, "filePath">) => void;
}

export class CardModal extends Modal {
  private title = "";
  private tags = "";
  private due = "";
  private priority: "low" | "medium" | "high" | "asap" = "medium";
  private textContent = "";
  private checklistItems: ChecklistItem[] = [];

  constructor(app: App, private options: CardModalOptions) {
    super(app);
    if (options.card) {
      this.title = options.card.title;
      this.tags = formatTags(options.card.tags);
      this.due = options.card.due ?? "";
      this.priority = options.card.priority ?? "medium";
      const { items, text } = parseChecklist(options.card.content);
      this.checklistItems = items;
      this.textContent = text;
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

    // Priority — 세그먼트 토글
    const priorityOptions: { value: typeof this.priority; label: string }[] = [
      { value: "low",    label: "🔵 낮음" },
      { value: "medium", label: "🟡 중간" },
      { value: "high",   label: "🔴 높음" },
      { value: "asap",   label: "🚨 ASAP" },
    ];

    const prioritySetting = new Setting(contentEl).setName("우선순위");
    const toggleGroup = prioritySetting.controlEl.createDiv("kanban-priority-toggle");

    for (const opt of priorityOptions) {
      const btn = toggleGroup.createEl("button", {
        text: opt.label,
        cls: `kanban-priority-btn priority-btn-${opt.value}${this.priority === opt.value ? " active" : ""}`,
      });
      btn.addEventListener("click", () => {
        this.priority = opt.value;
        toggleGroup.querySelectorAll(".kanban-priority-btn").forEach((b) => b.removeClass("active"));
        btn.addClass("active");
      });
    }

    // Content
    new Setting(contentEl).setName("내용").addTextArea((area) => {
      area
        .setPlaceholder("카드 내용 (선택 사항)...")
        .setValue(this.textContent)
        .onChange((v) => (this.textContent = v));
      area.inputEl.rows = 4;
      area.inputEl.style.width = "100%";
    });

    // Checklist
    const checklistSection = contentEl.createDiv("kanban-checklist-section");
    checklistSection.createEl("div", { text: "체크리스트", cls: "kanban-checklist-header" });

    const itemsContainer = checklistSection.createDiv("kanban-checklist-items");
    this.renderChecklistItems(itemsContainer);

    const addItemBtn = checklistSection.createEl("button", {
      text: "+ 항목 추가",
      cls: "kanban-checklist-add-btn",
    });
    addItemBtn.addEventListener("click", () => {
      this.checklistItems.push({ text: "", checked: false });
      this.renderChecklistItems(itemsContainer);
      // focus last input
      const inputs = itemsContainer.querySelectorAll<HTMLInputElement>(".kanban-checklist-item-input");
      inputs[inputs.length - 1]?.focus();
    });

    // Buttons
    const btnRow = contentEl.createDiv("kanban-modal-buttons");

    const cancelBtn = btnRow.createEl("button", { text: "취소" });
    cancelBtn.addEventListener("click", () => this.close());

    const submitBtn = btnRow.createEl("button", {
      text: this.options.card ? "저장" : "추가",
      cls: "mod-cta",
    });
    submitBtn.addEventListener("click", () => this.submit(titleInput));

    // Submit on Enter in title field
    titleInput!.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.submit(titleInput);
    });
  }

  private renderChecklistItems(container: HTMLElement) {
    container.empty();
    for (let i = 0; i < this.checklistItems.length; i++) {
      const item = this.checklistItems[i];
      const row = container.createDiv("kanban-checklist-item");

      const checkbox = row.createEl("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.checked;
      checkbox.className = "kanban-checklist-checkbox";
      checkbox.addEventListener("change", () => {
        this.checklistItems[i].checked = checkbox.checked;
      });

      const input = row.createEl("input");
      input.type = "text";
      input.value = item.text;
      input.placeholder = "항목 입력...";
      input.className = "kanban-checklist-item-input";
      input.addEventListener("input", () => {
        this.checklistItems[i].text = input.value;
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.checklistItems.splice(i + 1, 0, { text: "", checked: false });
          this.renderChecklistItems(container);
          const inputs = container.querySelectorAll<HTMLInputElement>(".kanban-checklist-item-input");
          inputs[i + 1]?.focus();
        } else if (e.key === "Backspace" && input.value === "") {
          e.preventDefault();
          this.checklistItems.splice(i, 1);
          this.renderChecklistItems(container);
          const inputs = container.querySelectorAll<HTMLInputElement>(".kanban-checklist-item-input");
          inputs[Math.max(0, i - 1)]?.focus();
        }
      });

      const delBtn = row.createEl("button", { text: "×", cls: "kanban-checklist-del-btn" });
      delBtn.addEventListener("click", () => {
        this.checklistItems.splice(i, 1);
        this.renderChecklistItems(container);
      });
    }
  }

  private submit(titleInput: HTMLInputElement) {
    if (!this.title.trim()) {
      titleInput.style.outline = "2px solid red";
      titleInput.focus();
      return;
    }

    // 빈 항목 제거 후 content 조합
    const validItems = this.checklistItems.filter((item) => item.text.trim());
    const checklistStr = formatChecklist(validItems);
    const fullContent = [this.textContent.trim(), checklistStr].filter(Boolean).join("\n\n");

    this.options.onSubmit({
      title: this.title.trim(),
      tags: parseTags(this.tags),
      due: this.due || undefined,
      priority: this.priority,
      created: this.options.card?.created ?? new Date().toISOString(),
      content: fullContent,
      status: this.options.card?.status ?? "todo",
    });
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
