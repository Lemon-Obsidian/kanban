import {
  App,
  TFile,
  TFolder,
  normalizePath,
  parseYaml,
  stringifyYaml,
} from "obsidian";
import { KanbanCard, ColumnStatus, KanbanSettings } from "./types";
import { slugify } from "./utils";

export class FileManager {
  constructor(private app: App, private settings: KanbanSettings) {}

  private getColumnPath(status: ColumnStatus): string {
    return normalizePath(`${this.settings.boardFolder}/${status}`);
  }

  async ensureFolders(): Promise<void> {
    const paths = [
      this.settings.boardFolder,
      `${this.settings.boardFolder}/todo`,
      `${this.settings.boardFolder}/doing`,
      `${this.settings.boardFolder}/done`,
    ];
    for (const p of paths) {
      const normalized = normalizePath(p);
      if (!this.app.vault.getAbstractFileByPath(normalized)) {
        await this.app.vault.createFolder(normalized);
      }
    }
  }

  private buildFileContent(card: KanbanCard): string {
    const fm: Record<string, unknown> = {
      tags: card.tags,
      created: card.created,
    };
    if (card.due) fm.due = card.due;
    if (card.priority) fm.priority = card.priority;

    const yaml = stringifyYaml(fm).trim();
    const body = card.content ? `\n\n${card.content}` : "";
    return `---\n${yaml}\n---\n\n# ${card.title}${body}`;
  }

  private parseFileContent(
    filePath: string,
    raw: string,
    status: ColumnStatus
  ): KanbanCard {
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    let fm: Record<string, unknown> = {};
    let body = raw;

    if (fmMatch) {
      try {
        fm = (parseYaml(fmMatch[1]) as Record<string, unknown>) || {};
      } catch {
        fm = {};
      }
      body = fmMatch[2].trim();
    }

    const titleMatch = body.match(/^#\s+(.+)$/m);
    const title =
      titleMatch?.[1] ??
      (filePath.split("/").pop()?.replace(".md", "") || "Untitled");
    const content = body.replace(/^#\s+.+\n?/m, "").trim();

    return {
      title,
      tags: Array.isArray(fm.tags) ? (fm.tags as string[]) : [],
      due: typeof fm.due === "string" ? fm.due : undefined,
      priority:
        fm.priority === "low" ||
        fm.priority === "medium" ||
        fm.priority === "high"
          ? fm.priority
          : undefined,
      created:
        typeof fm.created === "string" ? fm.created : new Date().toISOString(),
      content,
      filePath,
      status,
    };
  }

  async loadCards(status?: ColumnStatus): Promise<KanbanCard[]> {
    const statuses: ColumnStatus[] = status
      ? [status]
      : ["todo", "doing", "done"];
    const cards: KanbanCard[] = [];

    for (const s of statuses) {
      const folder = this.app.vault.getAbstractFileByPath(
        this.getColumnPath(s)
      );
      if (!(folder instanceof TFolder)) continue;

      for (const child of folder.children) {
        if (!(child instanceof TFile) || child.extension !== "md") continue;
        const raw = await this.app.vault.read(child);
        cards.push(this.parseFileContent(child.path, raw, s));
      }
    }

    return cards.sort(
      (a, b) =>
        new Date(b.created).getTime() - new Date(a.created).getTime()
    );
  }

  async createCard(
    card: Omit<KanbanCard, "filePath">
  ): Promise<KanbanCard> {
    await this.ensureFolders();

    const slug = slugify(card.title) || `card-${Date.now()}`;
    const folderPath = this.getColumnPath(card.status);
    let filePath = normalizePath(`${folderPath}/${slug}.md`);

    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(filePath)) {
      filePath = normalizePath(`${folderPath}/${slug}-${counter++}.md`);
    }

    const full: KanbanCard = { ...card, filePath };
    await this.app.vault.create(filePath, this.buildFileContent(full));
    return full;
  }

  async updateCard(card: KanbanCard): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(card.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.modify(file, this.buildFileContent(card));
  }

  async moveCard(card: KanbanCard, newStatus: ColumnStatus): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(card.filePath);
    if (!(file instanceof TFile)) return;

    await this.ensureFolders();

    const filename = file.name;
    const newFolder = this.getColumnPath(newStatus);
    let newPath = normalizePath(`${newFolder}/${filename}`);

    let counter = 1;
    while (
      this.app.vault.getAbstractFileByPath(newPath) &&
      newPath !== card.filePath
    ) {
      const base = filename.replace(".md", "");
      newPath = normalizePath(`${newFolder}/${base}-${counter++}.md`);
    }

    await this.app.vault.rename(file, newPath);
  }

  async deleteCard(card: KanbanCard): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(card.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.trash(file, true);
  }
}
