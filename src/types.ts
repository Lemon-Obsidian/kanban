export interface KanbanCard {
  title: string;
  tags: string[];
  due?: string;
  priority?: "low" | "medium" | "high";
  created: string;
  content: string;
  filePath: string;
  status: string; // column id
}

export interface ArchivedCard extends KanbanCard {
  flushedAt: string;  // ISO timestamp
  flushedFrom: string; // original column id
}

export interface KanbanColumn {
  id: string;        // subfolder name
  label: string;     // display name
  flushable?: boolean;
}

export interface KanbanSettings {
  boardFolder: string;
  columns: KanbanColumn[];
}

export const DEFAULT_SETTINGS: KanbanSettings = {
  boardFolder: "Kanban",
  columns: [
    { id: "todo",  label: "TO-DO",       flushable: false },
    { id: "doing", label: "IN PROGRESS", flushable: false },
    { id: "done",  label: "DONE",        flushable: true  },
  ],
};
