import {
  App,
  TFile,
  TFolder,
  normalizePath,
  parseYaml,
  stringifyYaml,
} from "obsidian";
import { ArchivedCard, KanbanCard, KanbanSettings } from "./types";
import { slugify } from "./utils";

export class FileManager {
  constructor(private app: App, private settings: KanbanSettings) {}

  private getColumnPath(columnId: string): string {
    return normalizePath(`${this.settings.boardFolder}/${columnId}`);
  }

  private getArchiveBasePath(): string {
    return normalizePath(`${this.settings.boardFolder}/_archive`);
  }

  private getArchiveMonthPath(date: Date): string {
    const month = date.toISOString().slice(0, 7); // "YYYY-MM"
    return normalizePath(`${this.getArchiveBasePath()}/${month}`);
  }

  async ensureFolders(): Promise<void> {
    const paths = [
      this.settings.boardFolder,
      ...this.settings.columns.map((c) => `${this.settings.boardFolder}/${c.id}`),
    ];
    for (const p of paths) {
      const normalized = normalizePath(p);
      if (!this.app.vault.getAbstractFileByPath(normalized)) {
        await this.app.vault.createFolder(normalized);
      }
    }
  }

  private async ensureArchiveMonthFolder(date: Date): Promise<void> {
    const base = this.getArchiveBasePath();
    const month = this.getArchiveMonthPath(date);
    for (const p of [base, month]) {
      if (!this.app.vault.getAbstractFileByPath(p)) {
        await this.app.vault.createFolder(p);
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
    status: string
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
        fm.priority === "low" || fm.priority === "medium" || fm.priority === "high"
          ? fm.priority
          : undefined,
      created:
        typeof fm.created === "string" ? fm.created : new Date().toISOString(),
      content,
      filePath,
      status,
    };
  }

  async loadCards(columnId?: string): Promise<KanbanCard[]> {
    const ids = columnId
      ? [columnId]
      : this.settings.columns.map((c) => c.id);
    const cards: KanbanCard[] = [];

    for (const id of ids) {
      const folder = this.app.vault.getAbstractFileByPath(
        this.getColumnPath(id)
      );
      if (!(folder instanceof TFolder)) continue;

      for (const child of folder.children) {
        if (!(child instanceof TFile) || child.extension !== "md") continue;
        const raw = await this.app.vault.read(child);
        cards.push(this.parseFileContent(child.path, raw, id));
      }
    }

    return cards.sort(
      (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
    );
  }

  async createCard(card: Omit<KanbanCard, "filePath">): Promise<KanbanCard> {
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

  async moveCard(card: KanbanCard, newColumnId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(card.filePath);
    if (!(file instanceof TFile)) return;

    await this.ensureFolders();

    const filename = file.name;
    const newFolder = this.getColumnPath(newColumnId);
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

  // ── Flush ────────────────────────────────────────────────────────────────

  async flushColumn(columnId: string): Promise<number> {
    const cards = await this.loadCards(columnId);
    if (cards.length === 0) return 0;

    const now = new Date();
    await this.ensureArchiveMonthFolder(now);
    const monthPath = this.getArchiveMonthPath(now);

    for (const card of cards) {
      const file = this.app.vault.getAbstractFileByPath(card.filePath);
      if (!(file instanceof TFile)) continue;

      // frontmatter에 flush 메타데이터 추가
      const raw = await this.app.vault.read(file);
      const updated = this.injectFlushMeta(raw, now, columnId);
      await this.app.vault.modify(file, updated);

      // _archive/YYYY-MM/ 로 이동
      const filename = file.name;
      let newPath = normalizePath(`${monthPath}/${filename}`);
      let counter = 1;
      while (this.app.vault.getAbstractFileByPath(newPath)) {
        const base = filename.replace(".md", "");
        newPath = normalizePath(`${monthPath}/${base}-${counter++}.md`);
      }

      await this.app.vault.rename(file, newPath);
    }

    return cards.length;
  }

  private injectFlushMeta(raw: string, flushedAt: Date, flushedFrom: string): string {
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    let fm: Record<string, unknown> = {};
    let rest = raw;

    if (fmMatch) {
      try { fm = (parseYaml(fmMatch[1]) as Record<string, unknown>) || {}; } catch { /**/ }
      rest = fmMatch[2];
    }

    fm.flushedAt = flushedAt.toISOString();
    fm.flushedFrom = flushedFrom;

    return `---\n${stringifyYaml(fm).trim()}\n---\n${rest}`;
  }

  // ── Archive ──────────────────────────────────────────────────────────────

  async loadArchivedCards(): Promise<ArchivedCard[]> {
    const archiveFolder = this.app.vault.getAbstractFileByPath(
      this.getArchiveBasePath()
    );
    if (!(archiveFolder instanceof TFolder)) return [];

    const cards: ArchivedCard[] = [];

    for (const monthFolder of archiveFolder.children) {
      if (!(monthFolder instanceof TFolder)) continue;

      for (const child of monthFolder.children) {
        if (!(child instanceof TFile) || child.extension !== "md") continue;
        const raw = await this.app.vault.read(child);
        const card = this.parseArchivedCard(child.path, raw);
        if (card) cards.push(card);
      }
    }

    return cards.sort(
      (a, b) => new Date(b.flushedAt).getTime() - new Date(a.flushedAt).getTime()
    );
  }

  private parseArchivedCard(filePath: string, raw: string): ArchivedCard | null {
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fmMatch) return null;

    let fm: Record<string, unknown> = {};
    try { fm = (parseYaml(fmMatch[1]) as Record<string, unknown>) || {}; } catch { return null; }

    if (typeof fm.flushedAt !== "string" || typeof fm.flushedFrom !== "string") return null;

    const base = this.parseFileContent(filePath, raw, fm.flushedFrom as string);
    return { ...base, flushedAt: fm.flushedAt, flushedFrom: fm.flushedFrom as string };
  }

  async updateArchivedCard(card: ArchivedCard): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(card.filePath);
    if (!(file instanceof TFile)) return;

    const fm: Record<string, unknown> = {
      tags: card.tags,
      created: card.created,
      flushedAt: card.flushedAt,
      flushedFrom: card.flushedFrom,
    };
    if (card.due) fm.due = card.due;
    if (card.priority) fm.priority = card.priority;

    const yaml = stringifyYaml(fm).trim();
    const body = card.content ? `\n\n${card.content}` : "";
    await this.app.vault.modify(file, `---\n${yaml}\n---\n\n# ${card.title}${body}`);
  }
}
