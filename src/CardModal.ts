import { App, Modal, Setting } from "obsidian";
import { KanbanCard } from "./types";
import { parseTags, formatTags, ChecklistItem, parseChecklist, formatChecklist } from "./utils";

interface CardModalOptions {
  card?: KanbanCard;
  existingTags?: string[];
  onSubmit: (data: Omit<KanbanCard, "filePath">) => void;
}

export class CardModal extends Modal {
  private title = "";
  private tags = "";
  private due = "";
  private priority: "low" | "medium" | "high" | "asap" = "medium";
  private recur: "daily" | "weekly" | "monthly" | "" = "";
  private textContent = "";
  private checklistItems: ChecklistItem[] = [];

  constructor(app: App, private options: CardModalOptions) {
    super(app);
    if (options.card) {
      this.title = options.card.title;
      this.tags = formatTags(options.card.tags);
      this.due = options.card.due ?? "";
      this.priority = options.card.priority ?? "medium";
      this.recur = options.card.recur ?? "";
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

    // Tags (with autocomplete)
    const tagSetting = new Setting(contentEl)
      .setName("태그")
      .setDesc("#태그1 #태그2 형식으로 입력");

    const tagWrapper = tagSetting.controlEl.createDiv("kanban-tag-input-wrapper");
    const tagInput = tagWrapper.createEl("input", { type: "text", cls: "kanban-tag-text-input" });
    tagInput.placeholder = "#업무 #프로젝트...";
    tagInput.value = this.tags;
    tagInput.addEventListener("input", () => { this.tags = tagInput.value; updateDropdown(); });
    tagInput.addEventListener("keydown", (e) => handleTagKeydown(e));
    tagInput.addEventListener("blur", () => { setTimeout(() => dropdown.style.display = "none", 150); });

    const dropdown = tagWrapper.createDiv("kanban-tag-dropdown");
    dropdown.style.display = "none";

    const existingTags = this.options.existingTags ?? [];
    let activeIndex = -1;

    const getActiveWord = () => {
      const pos = tagInput.selectionStart ?? tagInput.value.length;
      let start = pos;
      while (start > 0 && tagInput.value[start - 1] !== " ") start--;
      const word = tagInput.value.slice(start, pos);
      return { word, start, end: pos };
    };

    const updateDropdown = () => {
      const { word } = getActiveWord();
      if (!word.startsWith("#") || word.length < 2) { dropdown.style.display = "none"; return; }
      const query = word.slice(1).toLowerCase();
      const alreadyUsed = new Set(parseTags(this.tags));
      const matches = existingTags.filter(
        (t) => t.toLowerCase().includes(query) && !alreadyUsed.has(t)
      );
      if (matches.length === 0) { dropdown.style.display = "none"; return; }

      dropdown.empty();
      activeIndex = -1;
      for (let i = 0; i < matches.length; i++) {
        const item = dropdown.createDiv({ text: `#${matches[i]}`, cls: "kanban-tag-dropdown-item" });
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selectTag(matches[i]);
        });
      }
      dropdown.style.display = "block";
    };

    const selectTag = (tag: string) => {
      const { start, end } = getActiveWord();
      const before = tagInput.value.slice(0, start);
      const after = tagInput.value.slice(end);
      tagInput.value = `${before}#${tag} ${after.trimStart()}`;
      this.tags = tagInput.value;
      const newPos = start + tag.length + 2;
      tagInput.setSelectionRange(newPos, newPos);
      tagInput.focus();
      dropdown.style.display = "none";
      activeIndex = -1;
    };

    const handleTagKeydown = (e: KeyboardEvent) => {
      const items = dropdown.querySelectorAll<HTMLElement>(".kanban-tag-dropdown-item");
      if (dropdown.style.display === "none" || items.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % items.length;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = (activeIndex - 1 + items.length) % items.length;
      } else if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        e.stopPropagation();
        const tag = items[activeIndex].textContent!.slice(1);
        selectTag(tag);
        return;
      } else if (e.key === "Escape") {
        dropdown.style.display = "none";
        return;
      } else {
        return;
      }
      items.forEach((el, i) => el.classList.toggle("active", i === activeIndex));
    };

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

    // Recur
    new Setting(contentEl)
      .setName("반복")
      .setDesc("완료 컬럼으로 이동 시 TO-DO에 자동으로 새 카드 생성")
      .addDropdown((dd) => {
        dd.addOption("", "반복 없음");
        dd.addOption("daily", "매일");
        dd.addOption("weekly", "매주");
        dd.addOption("monthly", "매월");
        dd.setValue(this.recur);
        dd.onChange((v) => (this.recur = v as typeof this.recur));
      });

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
      recur: this.recur || undefined,
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
